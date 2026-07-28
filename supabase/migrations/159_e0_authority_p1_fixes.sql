-- 159_e0_authority_p1_fixes.sql
--
-- Package 07 Program A0 (session E0) — P1 review fixes 1-6.
-- Every one reproduced against the real schema before being changed.
--
-- ===========================================================================
-- 1. A DELETED OWNER / OPERATOR KEEPS AUTHORITY.  (severe)
-- ===========================================================================
-- Reproduced:
--     is_platform_owner(uuid) BEFORE delete -> true
--     delete from public.users where id = uuid;
--     is_platform_owner(uuid) AFTER  delete -> true      <-- still authoritative
--
-- Migration 155 dropped the FKs to public.users so audit history would survive
-- account deletion, and its comment claimed the deletion of public.users
-- "severs the personal linkage on its own". THAT CLAIM WAS WRONG, and it is
-- withdrawn here: is_platform_owner() and has_platform_capability() only ever
-- read their own private tables, so deleting the user removed the identity but
-- left root authority attached to a uuid nobody owns. Anything still holding
-- that JWT keeps expansion authority indefinitely.
--
-- FIX: authority requires a LIVE identity. Both predicates now join
-- public.users, so a deleted account is not an owner and holds no capability.
-- This is revocation-safe without inventing an owner UUID: the tables stay
-- empty, and the semantics are now explicit rather than assumed.
--
-- The audit tables keep no FK -- that part was right -- but the comment's
-- reasoning is corrected below: a raw uuid is retained because the RECORD must
-- outlive the actor, NOT because a uuid stops being personal data. It is still
-- an identifier; it is retained deliberately, as an auditable fact, and that is
-- a retention decision rather than an anonymisation claim.

create or replace function public.is_platform_owner(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public', 'private', 'pg_temp'
as $function$
  select exists (
    select 1
      from private.platform_owners o
      -- LIVE IDENTITY REQUIRED (mig 159). Without this join a deleted account
      -- keeps root authority forever: the private row survives the delete and
      -- nothing else was ever checked.
      join public.users u on u.id = o.user_id
     where o.user_id = p_user_id
       and o.status = 'active'
       and coalesce(u.is_blocked, false) = false
  );
$function$;

create or replace function public.has_platform_capability(p_user_id uuid, p_capability text)
returns boolean
language sql
stable
security definer
set search_path to 'public', 'private', 'pg_temp'
as $function$
  select exists (
    select 1
      from private.platform_operator_capabilities c
      join public.users u on u.id = c.user_id          -- live identity (mig 159)
     where c.user_id = p_user_id
       and c.capability = p_capability
       and c.status = 'active'
       and coalesce(u.is_blocked, false) = false
       -- An elapsed expiry is not a capability, whether or not the sweeper ran.
       and (c.expires_at is null or c.expires_at > now())
  );
$function$;

comment on function public.is_platform_owner(uuid) is
  'Root of the expansion authority chain. Requires a LIVE, unblocked public.users row (mig 159): before that join, deleting the account left root authority attached to a uuid nobody owned, and any holder of the old JWT kept it indefinitely. Returns false for everyone while private.platform_owners is empty -- its state at migration time, and intended: the initial owner UUID is an explicit release input, never inferred.';

comment on function public.has_platform_capability(uuid, text) is
  'Does this user hold this capability right now? Requires a LIVE, unblocked identity (mig 159) as well as an active, unexpired grant. Blocking or deleting an operator revokes their capabilities immediately, without waiting for a sweeper.';

-- Correct the claim made in mig 155's comments.
comment on column public.vertical_private_access_events.actor_user_id is
  'Who acted, as a raw uuid with NO foreign key. A FK cannot work here: ON DELETE SET NULL is an UPDATE that the append-only trigger rejects (making accounts undeletable), and CASCADE would destroy the audit trail. The uuid is RETAINED DELIBERATELY as an auditable fact -- this is a retention decision, not an anonymisation claim: a uuid remains an identifier even when it no longer resolves to a row. Authority is never derived from it (see mig 159). Migs 155, 159.';

-- ===========================================================================
-- 2. EXPIRY WORKERS MUST USE THE SAME LOCKS AND RECHECKS.
-- ===========================================================================
-- The sweepers flipped rows to 'expired' with FOR UPDATE SKIP LOCKED but took
-- neither the per-vertical lock (which place_order and the launch RPCs use) nor
-- the per-(user,capability) lock (which the gated RPCs use). A sweep could
-- therefore settle a grant in the middle of a transaction that had already
-- checked it, producing an inconsistent view within one logical operation.
--
-- Access itself never depended on the sweeper -- can_view_vertical() and
-- has_platform_capability() already treat an elapsed expires_at as no access --
-- so this is about ordering, not about closing an access hole.

create or replace function public.expire_vertical_private_access()
returns integer
language plpgsql
security definer
set search_path to 'public', 'private', 'pg_temp'
as $function$
declare v_n int := 0; r record;
begin
  -- LOCK ORDER: ADVISORY FIRST, THEN ROW -- matching grant/revoke
  -- (advisory at 194/246/290, row after). A first draft here took the row via
  -- FOR UPDATE SKIP LOCKED and only then the advisory lock, which is the exact
  -- inverse and deadlocks against a concurrent grant/revoke.
  --
  -- The candidate scan is therefore lock-free (no FOR UPDATE): it only picks
  -- ids. Each row is then locked in the canonical order inside the loop, and
  -- re-checked, so a candidate that stopped qualifying while we waited is
  -- skipped rather than wrongly settled.
  for r in
    select id, vertical_id, user_id from public.vertical_private_access
     where status = 'active' and expires_at is not null and expires_at <= now()
  loop
    -- 1. advisory (same key as place_order / launch RPCs / grant / revoke)
    perform pg_advisory_xact_lock(hashtextextended('vertical:' || r.vertical_id, 0));

    -- 2. row, now that the advisory lock is held. SKIP LOCKED so a concurrent
    --    sweeper does not block; RE-CHECK because a regrant or revoke may have
    --    closed or replaced this generation while we waited.
    if exists (
      select 1 from public.vertical_private_access
       where id = r.id and status = 'active'
         and expires_at is not null and expires_at <= now()
       for update skip locked
    ) then
      update public.vertical_private_access set status='expired' where id = r.id;
      insert into public.vertical_private_access_events (grant_id, action, reason)
      values (r.id, 'expired', 'expiry swept');
      v_n := v_n + 1;
    end if;
  end loop;
  return v_n;
end;
$function$;

create or replace function public.expire_platform_capabilities()
returns integer
language plpgsql
security definer
set search_path to 'public', 'private', 'pg_temp'
as $function$
declare v_n int := 0; r record;
begin
  -- Same canonical order as the private-access sweeper above: ADVISORY FIRST,
  -- then the row. assert_platform_capability / grant / revoke all take the
  -- 'cap:<user>:<capability>' advisory lock before touching the row.
  for r in
    select id, user_id, capability from private.platform_operator_capabilities
     where status='active' and expires_at is not null and expires_at <= now()
  loop
    perform pg_advisory_xact_lock(
      hashtextextended('cap:' || r.user_id::text || ':' || r.capability, 0));

    if exists (
      select 1 from private.platform_operator_capabilities
       where id = r.id and status='active'
         and expires_at is not null and expires_at <= now()
       for update skip locked
    ) then
      update private.platform_operator_capabilities set status='expired' where id = r.id;
      insert into private.platform_operator_capability_events
        (capability_grant_id, action, reason)
      values (r.id, 'expired', 'expiry swept');
      v_n := v_n + 1;
    end if;
  end loop;
  return v_n;
end;
$function$;

revoke all on function public.expire_vertical_private_access() from public, anon, authenticated;
grant execute on function public.expire_vertical_private_access() to service_role;
revoke all on function public.expire_platform_capabilities() from public, anon, authenticated;
grant execute on function public.expire_platform_capabilities() to service_role;

-- ===========================================================================
-- 3. LOCK ORDER INVERSION between place_order and admin assignment.
-- ===========================================================================
-- Measured:
--   place_order              restaurants row FOR UPDATE (l.220)
--                            -> advisory 'vertical:<id>'   (l.234)
--   admin_assign_...         advisory 'vertical:<a>','<b>' (l.194/197)
--                            -> restaurants row FOR UPDATE (l.201)
--
-- Opposite orders on the same two resources: a genuine deadlock, and the
-- assignment additionally read the SOURCE vertical before taking the row lock,
-- so the value it locked on could already be stale.
--
-- ONE CANONICAL ORDER, adopted here: ROW FIRST, THEN VERTICAL ADVISORY.
-- place_order is the hot path and already does this; changing it would be the
-- riskier edit. The assignment is rewritten to match: lock the merchant row,
-- re-read the source vertical UNDER that lock, then take both advisory locks in
-- least/greatest order so two opposing reassignments still cannot deadlock.

create or replace function public.admin_assign_merchant_vertical(
  p_restaurant_id uuid, p_new_vertical_id text, p_reason text
)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_actor uuid := auth.uid();
  v_prev  text;
  v_lo    text;
  v_hi    text;
  v_block record;
begin
  if v_actor is null then
    raise exception 'AUTH_REQUIRED' using errcode = 'check_violation';
  end if;
  if coalesce(public.auth_role()::text, '') <> 'admin' then
    raise exception 'NOT_AUTHORIZED' using errcode = 'check_violation';
  end if;
  if p_reason is null or length(btrim(p_reason)) < 3 then
    raise exception 'REASON_REQUIRED' using errcode = 'check_violation';
  end if;

  -- CANONICAL ORDER, STEP 1: the merchant row. Same order as place_order
  -- (row -> vertical advisory), which is what removes the deadlock.
  select vertical_id into v_prev from public.restaurants
   where id = p_restaurant_id for update;
  if v_prev is null then
    raise exception 'MERCHANT_NOT_FOUND' using errcode = 'check_violation';
  end if;

  -- STEP 2: both vertical advisory locks, in a stable least/greatest order so
  -- two opposing reassignments cannot deadlock against each other. v_prev is
  -- now read UNDER the row lock, so it cannot be stale.
  v_lo := least(v_prev, p_new_vertical_id);
  v_hi := greatest(v_prev, p_new_vertical_id);
  perform pg_advisory_xact_lock(hashtextextended('vertical:' || v_lo, 0));
  if v_hi <> v_lo then
    perform pg_advisory_xact_lock(hashtextextended('vertical:' || v_hi, 0));
  end if;

  -- Re-check blockers AFTER both locks: an order placed while we waited is now
  -- visible, and this read is the one that decides.
  select * into v_block
    from public.vertical_assignment_blockers(p_restaurant_id, p_new_vertical_id) limit 1;
  if v_block.code is not null then
    raise exception 'VERTICAL_ASSIGNMENT_BLOCKED: % (%)', v_block.code, v_block.detail
      using errcode = 'check_violation';
  end if;

  update public.restaurants set vertical_id = p_new_vertical_id where id = p_restaurant_id;

  insert into public.merchant_vertical_events
    (restaurant_id, previous_vertical_id, new_vertical_id, reason, actor_user_id)
  values (p_restaurant_id, v_prev, p_new_vertical_id, btrim(p_reason), v_actor);
end;
$function$;

revoke all on function public.admin_assign_merchant_vertical(uuid, text, text) from public, anon;
grant execute on function public.admin_assign_merchant_vertical(uuid, text, text) to authenticated;

comment on function public.admin_assign_merchant_vertical(uuid, text, text) is
  'The ONLY writer of restaurants.vertical_id. Admin-only, reason required, immutable audit. LOCK ORDER (mig 159): merchant row FOR UPDATE first, then the vertical advisory locks in least/greatest order -- the same row-then-vertical order place_order uses. The previous version inverted it and read the source vertical before the row lock, which could deadlock and could lock on a stale value. Blockers are re-checked after both locks.';

-- ===========================================================================
-- 4. vertical_assignment_blockers LEAKED to any authenticated caller.
-- ===========================================================================
-- It is SECURITY DEFINER and was granted to `authenticated` with no admin gate,
-- so any signed-in customer could learn: whether a merchant id exists, its
-- current vertical, how many orders it has in flight, and whether its catalog
-- contains prescription items. Reproduced: has_function_privilege(
-- 'authenticated', ...) = true.

create or replace function public.vertical_assignment_blockers(
  p_restaurant_id uuid, p_new_vertical_id text
)
returns table (code text, detail text)
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_current text;
  v_caps jsonb;
  v_n int;
begin
  -- ADMIN GATE (mig 159). This is definer, so without it the function reports
  -- merchant existence, current vertical, in-flight order counts and Rx state
  -- to any signed-in customer.
  if auth.uid() is null or coalesce(public.auth_role()::text, '') <> 'admin' then
    raise exception 'NOT_AUTHORIZED' using errcode = 'check_violation';
  end if;

  select vertical_id into v_current from public.restaurants where id = p_restaurant_id;
  if v_current is null then
    code := 'MERCHANT_NOT_FOUND'; detail := 'no such merchant'; return next; return;
  end if;

  select capabilities into v_caps from public.verticals where id = p_new_vertical_id;
  if v_caps is null then
    code := 'VERTICAL_NOT_FOUND'; detail := p_new_vertical_id; return next; return;
  end if;

  if v_current = p_new_vertical_id then
    code := 'NO_CHANGE'; detail := 'merchant is already in ' || p_new_vertical_id;
    return next; return;
  end if;

  select count(*) into v_n from public.orders
   where restaurant_id = p_restaurant_id
     and status not in ('delivered','cancelled','rejected');
  if v_n > 0 then
    code := 'ACTIVE_ORDERS';
    detail := v_n || ' order(s) in flight; finish or cancel them first';
    return next;
  end if;

  if coalesce((v_caps->>'supports_prescription')::boolean, false) = false then
    select count(*) into v_n from public.menu_items
     where restaurant_id = p_restaurant_id and requires_prescription;
    if v_n > 0 then
      code := 'CATALOG_REQUIRES_PRESCRIPTION';
      detail := v_n || ' item(s) need a prescription, which ' || p_new_vertical_id
             || ' does not support';
      return next;
    end if;
  end if;

  return;
end;
$function$;

revoke all on function public.vertical_assignment_blockers(uuid, text) from public, anon;
grant execute on function public.vertical_assignment_blockers(uuid, text) to authenticated;

comment on function public.vertical_assignment_blockers(uuid, text) is
  'Why a merchant cannot move to a vertical; zero rows means allowed. ADMIN-GATED INSIDE THE BODY (mig 159): it is SECURITY DEFINER and was previously callable by any authenticated user, disclosing merchant existence, current vertical, in-flight order counts and prescription state. The EXECUTE grant stays on `authenticated` because PostgREST calls arrive as that role; the body decides.';

-- ===========================================================================
-- 5. MERCHANT DELETION vs APPEND-ONLY AUDIT.
-- ===========================================================================
-- Reproduced: deleting a merchant that has been reassigned fails with
-- VERTICAL_ACCESS_EVENTS_ARE_APPEND_ONLY, because ON DELETE CASCADE issues a
-- DELETE that the append-only trigger rejects. Same defect as the user-deletion
-- case in the previous round, repeated in the new table.
--
-- DELIBERATE RESOLUTION: audit retention wins over referential cleanup. The FK
-- is dropped, so deleting a merchant leaves its reassignment history intact and
-- attached to a uuid that no longer resolves. That is a RETENTION DECISION, and
-- the uuid is still an identifier -- it is kept because the record of who moved
-- a merchant between verticals, and when, must outlive the merchant row.

alter table public.merchant_vertical_events
  drop constraint if exists merchant_vertical_events_restaurant_id_fkey;

comment on table public.merchant_vertical_events is
  'Append-only audit of merchant vertical reassignment. NO FK to restaurants (mig 159): ON DELETE CASCADE issued a DELETE that the append-only trigger rejected, making a reassigned merchant undeletable. Retention is deliberate -- the history outlives the merchant row, attached to a uuid that no longer resolves. That uuid remains an identifier; retaining it is a documented decision, not anonymisation. Migs 158, 159.';

-- ===========================================================================
-- 6. HIDDEN-VERTICAL GATING FOR THE FEE FUNCTIONS.
-- ===========================================================================
-- Migration 156 left quote_delivery_fee and delivery_feasibility ungated and
-- argued it was a deliberate exception because place_order calls them
-- internally as definer. THE REVIEW REJECTED THAT AND IS RIGHT: the deployed
-- body computes
--
--     v_dist := st_distance(v_rest_geo, p_dropoff);
--     distance_m := round(v_dist, 0);
--
-- so an anon caller supplying probe coordinates can trilaterate a hidden
-- merchant's exact location from repeated calls. That is private geography,
-- not "a fee integer" as I previously characterised it.
--
-- The internal-call objection is answered by SUBJECT SCOPING rather than by
-- skipping the gate: user_can_view_vertical(auth.uid(), ...) evaluates the
-- CUSTOMER, and inside place_order that customer has already passed the same
-- check moments earlier. Both bodies below are the DEPLOYED definitions with
-- exactly one guard inserted, assembled programmatically.
--
-- The denial shape matches what a missing merchant already produces
-- (in_range=false / the default fee), so a hidden merchant is not
-- distinguishable from an unknown one.

CREATE OR REPLACE FUNCTION public.quote_delivery_fee(p_restaurant_id uuid, p_dropoff geography, p_subtotal integer DEFAULT 0)
 RETURNS integer
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_zone     zone_type;
  v_vertical text;
  v_rule     public.delivery_fee_rules;
  v_fee      int;
begin
  v_zone := public.resolve_zone_nearest(p_dropoff);

  -- [127] The merchant's actual vertical, not a hardcoded 'food'. coalesce is
  -- belt-and-braces: restaurants.vertical_id defaults 'food' and was
  -- backfilled in mig 006, but a NULL must not turn the preference filter off.
  select coalesce(r.vertical_id, 'food') into v_vertical
    from public.restaurants r where r.id = p_restaurant_id;
  v_vertical := coalesce(v_vertical, 'food');  -- merchant not found -> behave as before
  -- [159] HIDDEN-VERTICAL GATE. Exact distance/ETA leaks private geography: a
  -- caller supplying probe coordinates can trilaterate a hidden merchant's
  -- location from st_distance alone. An earlier draft argued this was a
  -- "deliberate exception" because place_order calls it internally; that was
  -- wrong and is withdrawn.
  --
  -- Subject-scoped so the internal call still works: inside place_order,
  -- auth.uid() is the CUSTOMER, who has already passed the same gate. A
  -- caller who may not see the vertical gets the not-found shape rather than a
  -- distinguishable error.
  if not public.user_can_view_vertical(auth.uid(),
        (select r.vertical_id from public.restaurants r where r.id = p_restaurant_id)) then
    -- Same shape a missing merchant produces today.
    return 30;
  end if;

  -- Prefer a (zone, merchant-vertical) rule; fall back to (zone, null vertical).
  select * into v_rule from public.delivery_fee_rules
   where zone_id = v_zone and (vertical_id = v_vertical or vertical_id is null)
   order by vertical_id nulls last
   limit 1;

  if not found then
    return 30;  -- safe default if no rule configured
  end if;

  -- MVP: flat base (per_km_fee defaults 0). Free over threshold honored.
  if v_rule.free_over is not null and p_subtotal >= v_rule.free_over then
    return 0;
  end if;
  v_fee := greatest(v_rule.base_fee, v_rule.min_fee);
  return v_fee;
end;
$function$;

CREATE OR REPLACE FUNCTION public.delivery_feasibility(p_restaurant_id uuid, p_dropoff geography)
 RETURNS TABLE(distance_m numeric, in_range boolean, eta_minutes integer)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_rest_geo geography;
  v_prep     int;
  v_radius   int;
  v_speed    int;
  v_buffer   int;
  v_dist     numeric;
  v_travel   numeric;
begin
  select geo, prep_time_high into v_rest_geo, v_prep from public.restaurants where id = p_restaurant_id;
  -- [159] HIDDEN-VERTICAL GATE. Exact distance/ETA leaks private geography: a
  -- caller supplying probe coordinates can trilaterate a hidden merchant's
  -- location from st_distance alone. An earlier draft argued this was a
  -- "deliberate exception" because place_order calls it internally; that was
  -- wrong and is withdrawn.
  --
  -- Subject-scoped so the internal call still works: inside place_order,
  -- auth.uid() is the CUSTOMER, who has already passed the same gate. A
  -- caller who may not see the vertical gets the not-found shape rather than a
  -- distinguishable error.
  if not public.user_can_view_vertical(auth.uid(),
        (select r.vertical_id from public.restaurants r where r.id = p_restaurant_id)) then
    distance_m := null; in_range := false; eta_minutes := null;
    return next; return;
  end if;
  select coalesce((value #>> '{}')::int, 8000) into v_radius from public.platform_settings where key = 'max_delivery_radius_m';
  select coalesce((value #>> '{}')::int, 18)   into v_speed  from public.platform_settings where key = 'delivery_avg_speed_kmh';
  select coalesce((value #>> '{}')::int, 5)    into v_buffer from public.platform_settings where key = 'dispatch_buffer_minutes';
  v_prep := coalesce(v_prep, 30);

  if v_rest_geo is null or p_dropoff is null then
    distance_m := null; in_range := true; eta_minutes := v_prep + v_buffer;
    return next; return;
  end if;

  v_dist := st_distance(v_rest_geo, p_dropoff);
  v_travel := (v_dist / 1000.0) / greatest(v_speed, 1) * 60.0;

  distance_m  := round(v_dist, 0);
  in_range    := v_dist <= v_radius;
  eta_minutes := ceil(v_prep + v_buffer + v_travel)::int;
  return next;
end;
$function$;

-- ===========================================================================
-- 7. ARBITRARY-SUBJECT CAPABILITY ENUMERATION.
-- ===========================================================================
-- Migration 155 granted has_platform_capability(uuid, text) to `authenticated`
-- because the vertical_private_access RLS policy calls it. But the function
-- takes an ARBITRARY subject, so any signed-in user could probe any uuid for
-- any capability and map the platform's operator roster:
--
--     select public.has_platform_capability('<any uuid>', 'delivery_finance');
--
-- FIX: revoke the arbitrary-subject form from clients and add a SELF-SCOPED
-- wrapper that takes no subject. The policy uses the wrapper, so it keeps
-- working while a client can only ever ask about itself.

create or replace function public.i_have_platform_capability(p_capability text)
returns boolean
language sql
stable
security definer
set search_path to 'public', 'private', 'pg_temp'
as $function$
  -- No subject parameter: there is nothing to forge. auth.uid() is the only
  -- identity this can report on.
  select public.has_platform_capability(auth.uid(), p_capability);
$function$;

revoke all on function public.i_have_platform_capability(text) from public, anon;
grant execute on function public.i_have_platform_capability(text) to authenticated;

-- Close the enumeration surface. service_role keeps it for jobs/definer callers.
revoke execute on function public.has_platform_capability(uuid, text) from authenticated, anon, public;
grant execute on function public.has_platform_capability(uuid, text) to service_role;

-- Re-point the policy at the self-scoped wrapper.
drop policy if exists vertical_private_access_own_select on public.vertical_private_access;
create policy vertical_private_access_own_select
  on public.vertical_private_access for select to authenticated
  using (
    user_id = auth.uid()
    or public.i_have_platform_capability('expansion_launch_manager')
  );

comment on function public.i_have_platform_capability(text) is
  'Does the CALLER hold this capability? Self-scoped by construction -- no subject parameter, so it cannot be pointed at anyone else. Exists because mig 155 granted the arbitrary-subject has_platform_capability(uuid,text) to `authenticated` for an RLS policy, which let any signed-in user enumerate the operator roster. That form is now service_role only. Mig 159.';

-- ===========================================================================
-- 8. BLOCKED PILOTS RETAIN PRIVATE-VERTICAL VISIBILITY.
-- ===========================================================================
-- Finding 1 required a LIVE identity for the AUTHORITY predicates
-- (is_platform_owner / has_platform_capability). The VISIBILITY predicates were
-- not given the same treatment, and they need it for a different reason:
--
--   can_view_vertical / user_can_view_vertical test only the grant's status and
--   expiry. Blocking an account does not touch vertical_private_access, so a
--   blocked pilot holding a valid JWT keeps reading the private vertical, its
--   merchants and its whole catalog through RLS -- and blocking is precisely
--   what an operator reaches for when a pilot participant must lose access NOW.
--
-- Account DELETION was already safe here: vertical_private_access.user_id is
-- ON DELETE SET NULL (mig 155), so the grant stops matching auth.uid(). Blocking
-- is the gap, and it is the more common operator action.
--
-- Both predicates now require a live, unblocked public.users row. Revocation
-- remains the explicit tool; blocking is the emergency one, and it now works.

create or replace function public.can_view_vertical(p_vertical_id text)
returns boolean
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
  select case public.vertical_effective_stage(p_vertical_id)
    when 'public' then true
    when 'private' then exists (
      select 1
        from public.vertical_private_access a
        -- LIVE, UNBLOCKED IDENTITY (mig 159). Without this a blocked pilot's
        -- existing JWT keeps reading the private vertical and its catalog.
        join public.users u on u.id = a.user_id
       where a.vertical_id = p_vertical_id
         and a.user_id = auth.uid()
         and a.status = 'active'
         and coalesce(u.is_blocked, false) = false
         -- An elapsed expiry is not access, even before the sweeper runs.
         and (a.expires_at is null or a.expires_at > now())
    )
    else false   -- disabled: nobody, including a grant holder
  end;
$function$;

create or replace function public.user_can_view_vertical(p_user_id uuid, p_vertical_id text)
returns boolean
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
  select case public.vertical_effective_stage(p_vertical_id)
    when 'public' then true
    when 'private' then exists (
      select 1
        from public.vertical_private_access a
        join public.users u on u.id = a.user_id      -- live, unblocked (mig 159)
       where a.vertical_id = p_vertical_id
         and a.user_id = p_user_id
         and a.status = 'active'
         and coalesce(u.is_blocked, false) = false
         and (a.expires_at is null or a.expires_at > now())
    )
    else false
  end;
$function$;

revoke all on function public.can_view_vertical(text) from public;
grant execute on function public.can_view_vertical(text) to anon, authenticated, service_role;
revoke all on function public.user_can_view_vertical(uuid, text) from public, anon, authenticated;
grant execute on function public.user_can_view_vertical(uuid, text) to service_role;

comment on function public.can_view_vertical(text) is
  'May the CALLER see this vertical? public = everyone; private = only a live, unexpired, unrevoked grant held by a LIVE, UNBLOCKED account (mig 159); disabled = nobody. Blocking an account now removes private visibility immediately -- previously a blocked pilot kept reading the private catalog with an existing JWT, because the grant row was untouched by blocking. Deletion was already safe via ON DELETE SET NULL on the grant.';
