-- 155_e0_authority_hardening.sql
--
-- Package 07 Program A0 (session E0) — review-round hardening.
--
-- Five findings from the pre-apply review, all reproduced against production
-- before being fixed.
--
-- ===========================================================================
-- P0. DIRECT INSERT ON public.orders BYPASSES place_order ENTIRELY.
-- ===========================================================================
-- Measured on production 2026-07-28:
--
--   has_table_privilege('authenticated','public.orders','INSERT') = true
--   has_table_privilege('anon',         'public.orders','INSERT') = true
--   orders_owner_insert  INSERT  WITH CHECK (auth.uid() = user_id)
--
-- So any holder of the ANON KEY -- which ships inside every app binary -- can
-- POST /rest/v1/orders and create an order row directly. The policy only checks
-- that the row claims your own user id; it says nothing about price, merchant
-- state, COD limits or vertical stage. Everything place_order exists to enforce
-- is optional.
--
-- This is not a vertical bug. It is a pre-existing hole that makes E0's whole
-- premise unachievable: gating place_order is pointless while the table beneath
-- it is directly writable. `order_items` is directly insertable too, so a
-- fabricated order can carry fabricated lines.
--
-- UPDATE is already correctly denied to both roles, so this is a FABRICATION
-- vector, not a tampering one -- but a fabricated order still reaches the
-- kitchen, the driver and the settlement ledger.
--
-- FIX: revoke INSERT and drop the policy. place_order is SECURITY DEFINER and
-- writes as the owner, so it is unaffected. This is the only remaining writer.
--
-- OLD-BINARY COMPATIBILITY: verified by inspection of the customer app -- every
-- order goes through db.orders.create() -> supabase.rpc('place_order'). No
-- shipped binary inserts into `orders` directly, so revoking the grant breaks
-- no released client. (apps/customer/src/data/supabase/orders.ts).

revoke insert on table public.orders from public, anon, authenticated;
revoke insert on table public.order_items from public, anon, authenticated;

drop policy if exists orders_owner_insert on public.orders;

comment on table public.orders is
  'Orders. INSERT is revoked from anon/authenticated (mig 155): place_order() is the ONLY writer. Before this, any anon-key holder could POST /rest/v1/orders directly and fabricate an order with chosen totals, bypassing pricing, merchant state, COD limits and the vertical launch gate -- orders_owner_insert only checked auth.uid() = user_id. UPDATE was already denied.';

-- ===========================================================================
-- 1/#3. ACCOUNT DELETION vs IMMUTABLE HISTORY.
-- ===========================================================================
-- The previous draft used ON DELETE SET NULL to keep audit rows when a user is
-- deleted. Reproduced on production: the delete FAILS.
--
--   ERROR: VERTICAL_ACCESS_EVENTS_ARE_APPEND_ONLY
--   CONTEXT: UPDATE ONLY "vertical_private_access_events"
--            SET "actor_user_id" = NULL WHERE ... = "actor_user_id"
--
-- SET NULL is implemented as an UPDATE, and the immutability trigger rejects
-- every UPDATE -- so the "fix" made accounts UNDELETABLE. platform_owners used
-- ON DELETE RESTRICT, which makes a platform owner permanently undeletable too.
--
-- The resolution keeps both properties without contradiction:
--   * event rows are never UPDATEd or DELETEd by anyone (trigger unchanged);
--   * the actor FK is dropped entirely -- the column keeps the raw uuid as a
--     historical fact, with no referential action to fire on delete;
--   * the deleted user's row disappears from public.users, so the uuid no
--     longer resolves to a person: the personal linkage is severed by the
--     deletion itself, which is what account deletion is required to achieve.
--
-- A uuid with no matching user is not personal data in any useful sense, and it
-- is what makes "this capability was granted at 14:02" auditable at all.

alter table public.vertical_private_access_events
  drop constraint if exists vertical_private_access_events_actor_user_id_fkey;
alter table public.vertical_launch_events
  drop constraint if exists vertical_launch_events_actor_user_id_fkey;
alter table private.platform_operator_capability_events
  drop constraint if exists platform_operator_capability_events_actor_user_id_fkey;

comment on column public.vertical_private_access_events.actor_user_id is
  'Who acted, as a raw uuid with NO foreign key (mig 155). A FK here cannot work: ON DELETE SET NULL is an UPDATE and the append-only trigger rejects it (making accounts undeletable), while CASCADE would delete the audit trail. Dropping the FK keeps the historical fact and lets the deletion of public.users sever the personal linkage on its own.';

-- The grant row itself: SET NULL is fine there (it is not append-only), but the
-- FK must not RESTRICT. Re-state it explicitly as SET NULL.
alter table public.vertical_private_access
  drop constraint if exists vertical_private_access_user_id_fkey;
alter table public.vertical_private_access
  add constraint vertical_private_access_user_id_fkey
  foreign key (user_id) references public.users(id) on delete set null;

-- platform_owners used ON DELETE RESTRICT -> an owner could never be deleted.
-- Ownership history matters more than the FK: drop it and keep the uuid.
alter table private.platform_owners
  drop constraint if exists platform_owners_user_id_fkey;

alter table private.platform_operator_capabilities
  drop constraint if exists platform_operator_capabilities_user_id_fkey;

comment on table private.platform_owners is
  'Root expansion authority. No FK to public.users (mig 155): ON DELETE RESTRICT made an owner permanently undeletable and CASCADE would erase who held root authority. The uuid is retained as a historical fact. Still EMPTY at migration time -- the initial owner UUID is an explicit release input, never inferred.';

-- Capability events must be append-only too. They were not protected before.
drop trigger if exists platform_operator_capability_events_no_mutate
  on private.platform_operator_capability_events;
create trigger platform_operator_capability_events_no_mutate
  before update or delete on private.platform_operator_capability_events
  for each row execute function public.vertical_access_events_immutable();

-- ===========================================================================
-- 2. CAPABILITY REVOCATION vs IN-FLIGHT CAPABILITY-GATED RPCs.
-- ===========================================================================
-- set_vertical_launch_stage() checks has_platform_capability() and then does
-- its work. A concurrent revoke_platform_capability() touches a different row,
-- so nothing blocks: the revoked operator's launch change can still commit.
--
-- Same shape as the close/order race, same remedy: a shared advisory lock keyed
-- on (user, capability), taken by BOTH the gated RPC and the revoker, with the
-- capability RE-CHECKED after the lock is held.

create or replace function public.assert_platform_capability(p_user_id uuid, p_capability text)
returns void
language plpgsql
security definer
set search_path to 'public', 'private', 'pg_temp'
as $function$
begin
  -- Serialise against revocation of THIS capability for THIS user.
  perform pg_advisory_xact_lock(
    hashtextextended('cap:' || p_user_id::text || ':' || p_capability, 0));

  -- Re-check AFTER the lock: a revocation that committed while we waited is now
  -- visible, and this is the read that decides.
  if not public.has_platform_capability(p_user_id, p_capability) then
    raise exception 'NOT_AUTHORIZED' using errcode = 'check_violation';
  end if;
end;
$function$;

revoke all on function public.assert_platform_capability(uuid, text) from public, anon, authenticated;
grant execute on function public.assert_platform_capability(uuid, text) to service_role;

comment on function public.assert_platform_capability(uuid, text) is
  'Capability gate that is SAFE AGAINST CONCURRENT REVOCATION (mig 155). Takes a per-(user,capability) advisory lock and re-checks after acquiring it, so a revoke committed while this transaction waited is seen. revoke_platform_capability() takes the same key, so a gated mutation cannot commit after its authority was withdrawn.';

-- ===========================================================================
-- 3. Rebuild the capability-gated RPCs to use the locking gate, and make
--    regrant/expiry append the events the previous draft omitted.
-- ===========================================================================
create or replace function public.grant_platform_capability(
  p_user_id uuid, p_capability text, p_reason text, p_expires_at timestamptz default null
)
returns uuid
language plpgsql
security definer
set search_path to 'public', 'private', 'pg_temp'
as $function$
declare v_actor uuid := auth.uid(); v_id uuid; v_old uuid;
begin
  if v_actor is null then raise exception 'AUTH_REQUIRED' using errcode='check_violation'; end if;
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

  perform pg_advisory_xact_lock(
    hashtextextended('cap:' || p_user_id::text || ':' || p_capability, 0));

  -- Close any live generation AND record it. The previous draft closed the row
  -- silently, so a regrant erased the fact that an earlier generation had been
  -- superseded.
  update private.platform_operator_capabilities
     set status='revoked', revoked_at=now()
   where user_id=p_user_id and capability=p_capability and status='active'
  returning id into v_old;

  if v_old is not null then
    insert into private.platform_operator_capability_events
      (capability_grant_id, action, actor_user_id, reason)
    values (v_old, 'revoked', v_actor, 'superseded by regrant: ' || btrim(p_reason));
  end if;

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

  -- SAME KEY the gated RPCs take: an in-flight launch change either commits
  -- before this revoke, or re-checks after it and fails.
  perform pg_advisory_xact_lock(
    hashtextextended('cap:' || p_user_id::text || ':' || p_capability, 0));

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

-- Capability expiry settlement, mirroring the private-access sweeper. Authority
-- itself does not depend on it -- has_platform_capability() already treats an
-- elapsed expires_at as no capability -- this settles the row and the event.
create or replace function public.expire_platform_capabilities()
returns integer
language plpgsql
security definer
set search_path to 'public', 'private', 'pg_temp'
as $function$
declare v_n int := 0; r record;
begin
  for r in
    select id from private.platform_operator_capabilities
     where status='active' and expires_at is not null and expires_at <= now()
     for update skip locked
  loop
    update private.platform_operator_capabilities set status='expired' where id = r.id;
    insert into private.platform_operator_capability_events
      (capability_grant_id, action, reason)
    values (r.id, 'expired', 'expiry swept');
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$function$;

revoke all on function public.expire_platform_capabilities() from public, anon, authenticated;
grant execute on function public.expire_platform_capabilities() to service_role;

-- Re-issue the launch/access RPCs against the LOCKING gate.
create or replace function public.set_vertical_launch_stage(
  p_vertical_id text, p_stage text, p_is_active boolean, p_reason text,
  p_evidence_reference text default null
)
returns void
language plpgsql
security definer
set search_path to 'public', 'private', 'pg_temp'
as $function$
declare v_actor uuid := auth.uid(); v_prev_stage text; v_prev_active boolean;
begin
  if v_actor is null then raise exception 'AUTH_REQUIRED' using errcode='check_violation'; end if;
  if p_stage not in ('disabled','private','public') then
    raise exception 'INVALID_STAGE' using errcode='check_violation';
  end if;
  if p_reason is null or length(btrim(p_reason)) < 3 then
    raise exception 'REASON_REQUIRED' using errcode='check_violation';
  end if;

  -- Locking gate: safe against a revocation racing this change.
  perform public.assert_platform_capability(v_actor, 'expansion_launch_manager');

  -- Same key place_order takes: a close cannot race an in-flight order.
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

create or replace function public.grant_vertical_private_access(
  p_vertical_id text, p_user_id uuid, p_cohort text, p_reason text,
  p_expires_at timestamptz default null
)
returns uuid
language plpgsql
security definer
set search_path to 'public', 'private', 'pg_temp'
as $function$
declare v_actor uuid := auth.uid(); v_id uuid; v_old uuid; v_gen int;
begin
  if v_actor is null then raise exception 'AUTH_REQUIRED' using errcode='check_violation'; end if;
  if p_reason is null or length(btrim(p_reason)) < 3 then
    raise exception 'REASON_REQUIRED' using errcode='check_violation';
  end if;
  if not exists (select 1 from public.verticals where id = p_vertical_id) then
    raise exception 'VERTICAL_NOT_FOUND' using errcode='check_violation';
  end if;
  if not exists (select 1 from public.users where id = p_user_id) then
    raise exception 'USER_NOT_FOUND' using errcode='check_violation';
  end if;

  perform public.assert_platform_capability(v_actor, 'expansion_launch_manager');
  perform pg_advisory_xact_lock(hashtextextended('vertical:' || p_vertical_id, 0));

  update public.vertical_private_access
     set status='revoked', revoked_at=now(), revoked_by=v_actor
   where vertical_id=p_vertical_id and user_id=p_user_id and status='active'
  returning id into v_old;

  -- Record the closed generation. The previous draft closed it silently.
  if v_old is not null then
    insert into public.vertical_private_access_events (grant_id, action, actor_user_id, reason)
    values (v_old, 'revoked', v_actor, 'superseded by regrant: ' || btrim(p_reason));
  end if;

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
  if p_reason is null or length(btrim(p_reason)) < 3 then
    raise exception 'REASON_REQUIRED' using errcode='check_violation';
  end if;

  perform public.assert_platform_capability(v_actor, 'expansion_launch_manager');
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

-- ===========================================================================
-- 4. STOP LEAKING THE EXACT STAGE, AND STOP COARSE ADMIN ENUMERATION.
-- ===========================================================================
-- vertical_effective_stage() was granted to anon/authenticated. It answers
-- "is grocery private or merely disabled?" to anyone who asks -- a roadmap
-- disclosure with no legitimate client use, since a client only ever needs the
-- boolean can_view_vertical().
revoke execute on function public.vertical_effective_stage(text) from anon, authenticated;

comment on function public.vertical_effective_stage(text) is
  'THE single definition of a vertical''s effective stage. NOT granted to clients (mig 155): the exact stage distinguishes "private, launching soon" from "disabled", which is unreleased-roadmap information. Clients use can_view_vertical(), which answers only the boolean they need. Policies still call this because they execute as the definer of can_view_vertical(). Migs 152, 155.';

-- Every coarse admin could read every private grant, including cohort names and
-- free-text reasons -- unreleased cohort structure. Narrow to the capability
-- holder; the grant subject still sees their own row.
drop policy if exists vertical_private_access_own_select on public.vertical_private_access;
create policy vertical_private_access_own_select
  on public.vertical_private_access for select to authenticated
  using (
    user_id = auth.uid()
    or public.has_platform_capability(auth.uid(), 'expansion_launch_manager')
  );

-- has_platform_capability is service-role only, but the policy above must be
-- evaluable by `authenticated`. It is SECURITY DEFINER, so grant EXECUTE and
-- rely on its internal scoping: it answers only about the uuid passed in, and
-- the policy passes auth.uid().
grant execute on function public.has_platform_capability(uuid, text) to authenticated;
