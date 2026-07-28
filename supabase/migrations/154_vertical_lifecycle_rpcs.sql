-- 154_vertical_lifecycle_rpcs.sql
--
-- Package 07 Program A0 (session E0) — the audited lifecycle authority.
--
-- Migration 152 created the tables and 153 enforced the stage on read/order
-- paths, but nothing could legitimately CHANGE any of it: launch state was
-- only movable by a direct UPDATE, which the spec forbids ("launch state
-- changes only through a definer RPC ... and always append
-- vertical_launch_events. Merchant/admin UI cannot write the columns directly").
--
-- THE AUTHORITY CHAIN, exactly as specified:
--
--   database owner -> private.platform_owners  (an explicit release input)
--        platform owner -> root capabilities   (expansion_launch_manager, ...)
--             expansion_launch_manager -> set_vertical_launch_stage
--             expansion_launch_manager -> grant/revoke private access
--
-- An ordinary admin sits nowhere on that chain and cannot self-grant. That is
-- the point: `role = 'admin'` is JWT-adjacent state, and the spec requires
-- launch authority to rest on server-owned capability rows instead.
--
-- BOOTSTRAP IS DELIBERATELY ABSENT. private.platform_owners is empty and no
-- function here inserts into it. With it empty, has_platform_capability()
-- returns false for everyone, so every RPC below fails closed and no launch
-- stage can move. Seeding it requires the platform-owner UUID, which is an
-- explicit release input and is NOT recorded anywhere in this repository
-- (checked 2026-07-28). That seed is a separate, owner-supplied migration.
--
-- CONCURRENCY. Every mutating RPC takes
--   pg_advisory_xact_lock(hashtextextended('vertical:' || <id>, 0))
-- which is the SAME key place_order takes (mig 153). A launch close or a grant
-- revocation therefore serialises against an in-flight order: either the order
-- commits before the close, or it re-reads the closed state and raises
-- VERTICAL_NOT_AVAILABLE. Without this the two touch different rows and neither
-- would block the other.

-- ---------------------------------------------------------------------------
-- 1. Capability predicate. Every RPC below gates on this.
-- ---------------------------------------------------------------------------
create or replace function public.has_platform_capability(p_user_id uuid, p_capability text)
returns boolean
language sql
stable
security definer
set search_path to 'public', 'private', 'pg_temp'
as $function$
  select exists (
    select 1 from private.platform_operator_capabilities c
     where c.user_id = p_user_id
       and c.capability = p_capability
       and c.status = 'active'
       -- An elapsed expiry is not a capability, whether or not a sweeper has
       -- run. Time must not wait on a cron.
       and (c.expires_at is null or c.expires_at > now())
  );
$function$;

revoke all on function public.has_platform_capability(uuid, text) from public, anon, authenticated;
grant execute on function public.has_platform_capability(uuid, text) to service_role;

create or replace function public.is_platform_owner(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public', 'private', 'pg_temp'
as $function$
  select exists (
    select 1 from private.platform_owners o
     where o.user_id = p_user_id and o.status = 'active'
  );
$function$;

revoke all on function public.is_platform_owner(uuid) from public, anon, authenticated;
grant execute on function public.is_platform_owner(uuid) to service_role;

comment on function public.is_platform_owner(uuid) is
  'Root of the expansion authority chain. Returns false for EVERYONE while private.platform_owners is empty, which is its state at migration time and the intended fail-closed posture -- the initial owner UUID is an explicit release input and is never inferred from the first admin. Mig 154.';

-- ---------------------------------------------------------------------------
-- 2. Capability grant / revoke. Platform-owner only.
-- ---------------------------------------------------------------------------
create or replace function public.grant_platform_capability(
  p_user_id uuid, p_capability text, p_reason text, p_expires_at timestamptz default null
)
returns uuid
language plpgsql
security definer
set search_path to 'public', 'private', 'pg_temp'
as $function$
declare v_actor uuid := auth.uid(); v_id uuid;
begin
  if v_actor is null then raise exception 'AUTH_REQUIRED' using errcode='check_violation'; end if;
  -- ONLY a platform owner. An admin cannot self-grant; that is the whole
  -- separation this table exists to create.
  if not public.is_platform_owner(v_actor) then
    raise exception 'NOT_PLATFORM_OWNER' using errcode='check_violation';
  end if;
  if p_reason is null or length(btrim(p_reason)) < 3 then
    raise exception 'REASON_REQUIRED' using errcode='check_violation';
  end if;
  if p_capability not in ('expansion_launch_manager','compliance_evidence_manager',
                          'product_compliance_reviewer','pharmacy_support',
                          'delivery_access','delivery_compliance','delivery_config',
                          'delivery_dispatch','delivery_support','delivery_finance') then
    raise exception 'INVALID_CAPABILITY' using errcode='check_violation';
  end if;

  -- Close any live generation first, then open a new one: history is retained,
  -- never overwritten.
  update private.platform_operator_capabilities
     set status='revoked', revoked_at=now()
   where user_id=p_user_id and capability=p_capability and status='active';

  insert into private.platform_operator_capabilities
    (user_id, capability, granted_by, expires_at, reason)
  values (p_user_id, p_capability, v_actor, p_expires_at, btrim(p_reason))
  returning id into v_id;

  insert into private.platform_operator_capability_events
    (capability_grant_id, action, actor_user_id, reason)
  values (v_id, 'granted', v_actor, btrim(p_reason));

  return v_id;
end;
$function$;

create or replace function public.revoke_platform_capability(
  p_user_id uuid, p_capability text, p_reason text
)
returns void
language plpgsql
security definer
set search_path to 'public', 'private', 'pg_temp'
as $function$
declare v_actor uuid := auth.uid(); v_id uuid;
begin
  if v_actor is null then raise exception 'AUTH_REQUIRED' using errcode='check_violation'; end if;
  if not public.is_platform_owner(v_actor) then
    raise exception 'NOT_PLATFORM_OWNER' using errcode='check_violation';
  end if;
  if p_reason is null or length(btrim(p_reason)) < 3 then
    raise exception 'REASON_REQUIRED' using errcode='check_violation';
  end if;

  update private.platform_operator_capabilities
     set status='revoked', revoked_at=now()
   where user_id=p_user_id and capability=p_capability and status='active'
  returning id into v_id;

  if v_id is not null then
    insert into private.platform_operator_capability_events
      (capability_grant_id, action, actor_user_id, reason)
    values (v_id, 'revoked', v_actor, btrim(p_reason));
  end if;
end;
$function$;

revoke all on function public.grant_platform_capability(uuid, text, text, timestamptz) from public, anon;
grant execute on function public.grant_platform_capability(uuid, text, text, timestamptz) to authenticated;
revoke all on function public.revoke_platform_capability(uuid, text, text) from public, anon;
grant execute on function public.revoke_platform_capability(uuid, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Launch stage. The only legitimate writer of verticals.launch_stage.
-- ---------------------------------------------------------------------------
create or replace function public.set_vertical_launch_stage(
  p_vertical_id text, p_stage text, p_is_active boolean, p_reason text,
  p_evidence_reference text default null
)
returns void
language plpgsql
security definer
set search_path to 'public', 'private', 'pg_temp'
as $function$
declare
  v_actor uuid := auth.uid();
  v_prev_stage text; v_prev_active boolean;
begin
  if v_actor is null then raise exception 'AUTH_REQUIRED' using errcode='check_violation'; end if;
  -- Capability, NOT role='admin'. Launch authority must rest on a server-owned
  -- row rather than on JWT-adjacent role state.
  if not public.has_platform_capability(v_actor, 'expansion_launch_manager') then
    raise exception 'NOT_AUTHORIZED' using errcode='check_violation';
  end if;
  if p_stage not in ('disabled','private','public') then
    raise exception 'INVALID_STAGE' using errcode='check_violation';
  end if;
  if p_reason is null or length(btrim(p_reason)) < 3 then
    raise exception 'REASON_REQUIRED' using errcode='check_violation';
  end if;

  -- SAME KEY place_order takes: serialise a close against an in-flight order.
  perform pg_advisory_xact_lock(hashtextextended('vertical:' || p_vertical_id, 0));

  select launch_stage, is_active into v_prev_stage, v_prev_active
    from public.verticals where id = p_vertical_id for update;
  if not found then raise exception 'VERTICAL_NOT_FOUND' using errcode='check_violation'; end if;

  update public.verticals
     set launch_stage = p_stage, is_active = coalesce(p_is_active, is_active)
   where id = p_vertical_id;

  insert into public.vertical_launch_events
    (vertical_id, previous_stage, new_stage, previous_is_active, new_is_active,
     reason, evidence_reference, actor_user_id)
  values (p_vertical_id, v_prev_stage, p_stage, v_prev_active,
          coalesce(p_is_active, v_prev_active), btrim(p_reason), p_evidence_reference, v_actor);
end;
$function$;

revoke all on function public.set_vertical_launch_stage(text, text, boolean, text, text) from public, anon;
grant execute on function public.set_vertical_launch_stage(text, text, boolean, text, text) to authenticated;

comment on function public.set_vertical_launch_stage(text, text, boolean, text, text) is
  'The ONLY legitimate writer of verticals.launch_stage/is_active. Requires an active expansion_launch_manager capability -- deliberately not role=''admin'', because launch authority must rest on a server-owned capability row rather than JWT-adjacent role state. Always appends vertical_launch_events. Takes the same advisory lock as place_order so a close cannot race an in-flight order. Mig 154.';

-- ---------------------------------------------------------------------------
-- 4. Private access: grant / revoke / expire, with generations and events.
-- ---------------------------------------------------------------------------
create or replace function public.grant_vertical_private_access(
  p_vertical_id text, p_user_id uuid, p_cohort text, p_reason text,
  p_expires_at timestamptz default null
)
returns uuid
language plpgsql
security definer
set search_path to 'public', 'private', 'pg_temp'
as $function$
declare v_actor uuid := auth.uid(); v_id uuid; v_gen int;
begin
  if v_actor is null then raise exception 'AUTH_REQUIRED' using errcode='check_violation'; end if;
  if not public.has_platform_capability(v_actor, 'expansion_launch_manager') then
    raise exception 'NOT_AUTHORIZED' using errcode='check_violation';
  end if;
  if p_reason is null or length(btrim(p_reason)) < 3 then
    raise exception 'REASON_REQUIRED' using errcode='check_violation';
  end if;
  if not exists (select 1 from public.verticals where id = p_vertical_id) then
    raise exception 'VERTICAL_NOT_FOUND' using errcode='check_violation';
  end if;
  if not exists (select 1 from public.users where id = p_user_id) then
    raise exception 'USER_NOT_FOUND' using errcode='check_violation';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('vertical:' || p_vertical_id, 0));

  -- Close the live generation, then open the next. The partial unique index
  -- allows exactly one active generation per (vertical, user).
  update public.vertical_private_access
     set status='revoked', revoked_at=now(), revoked_by=v_actor
   where vertical_id=p_vertical_id and user_id=p_user_id and status='active';

  select coalesce(max(generation), 0) + 1 into v_gen
    from public.vertical_private_access
   where vertical_id=p_vertical_id and user_id=p_user_id;

  insert into public.vertical_private_access
    (vertical_id, user_id, generation, status, cohort, reason, expires_at, granted_by)
  values (p_vertical_id, p_user_id, v_gen, 'active', p_cohort, btrim(p_reason),
          p_expires_at, v_actor)
  returning id into v_id;

  insert into public.vertical_private_access_events (grant_id, action, actor_user_id, reason)
  values (v_id, 'granted', v_actor, btrim(p_reason));

  return v_id;
end;
$function$;

create or replace function public.revoke_vertical_private_access(
  p_vertical_id text, p_user_id uuid, p_reason text
)
returns void
language plpgsql
security definer
set search_path to 'public', 'private', 'pg_temp'
as $function$
declare v_actor uuid := auth.uid(); v_id uuid;
begin
  if v_actor is null then raise exception 'AUTH_REQUIRED' using errcode='check_violation'; end if;
  if not public.has_platform_capability(v_actor, 'expansion_launch_manager') then
    raise exception 'NOT_AUTHORIZED' using errcode='check_violation';
  end if;
  if p_reason is null or length(btrim(p_reason)) < 3 then
    raise exception 'REASON_REQUIRED' using errcode='check_violation';
  end if;

  -- Same key as place_order: a revocation cannot race an in-flight order.
  perform pg_advisory_xact_lock(hashtextextended('vertical:' || p_vertical_id, 0));

  update public.vertical_private_access
     set status='revoked', revoked_at=now(), revoked_by=v_actor
   where vertical_id=p_vertical_id and user_id=p_user_id and status='active'
  returning id into v_id;

  if v_id is not null then
    insert into public.vertical_private_access_events (grant_id, action, actor_user_id, reason)
    values (v_id, 'revoked', v_actor, btrim(p_reason));
  end if;
end;
$function$;

-- Service-only idempotent sweeper. Flips elapsed grants to 'expired' and
-- records it. Access itself does NOT depend on this having run -- can_view_
-- vertical() already treats an elapsed expires_at as no access -- so a stalled
-- cron cannot extend anyone's access.
create or replace function public.expire_vertical_private_access()
returns integer
language plpgsql
security definer
set search_path to 'public', 'private', 'pg_temp'
as $function$
declare v_n int := 0; r record;
begin
  for r in
    select id, vertical_id from public.vertical_private_access
     where status = 'active' and expires_at is not null and expires_at <= now()
     for update skip locked
  loop
    update public.vertical_private_access set status='expired' where id = r.id;
    insert into public.vertical_private_access_events (grant_id, action, reason)
    values (r.id, 'expired', 'expiry swept');
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$function$;

revoke all on function public.grant_vertical_private_access(text, uuid, text, text, timestamptz) from public, anon;
grant execute on function public.grant_vertical_private_access(text, uuid, text, text, timestamptz) to authenticated;
revoke all on function public.revoke_vertical_private_access(text, uuid, text) from public, anon;
grant execute on function public.revoke_vertical_private_access(text, uuid, text) to authenticated;
revoke all on function public.expire_vertical_private_access() from public, anon, authenticated;
grant execute on function public.expire_vertical_private_access() to service_role;

comment on function public.expire_vertical_private_access() is
  'Service-only idempotent expiry sweeper. Access does NOT depend on it: can_view_vertical() already treats an elapsed expires_at as no access, so a stalled cron cannot extend anyone''s access -- this only settles the row and appends the event. FOR UPDATE SKIP LOCKED so concurrent runs do not fight. Mig 154.';
