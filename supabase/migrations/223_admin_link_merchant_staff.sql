-- 223_admin_link_merchant_staff.sql
--
-- Give an EXISTING restaurant its first staff account.
--
-- THE GAP. Every one of the 44 live restaurants was created by import
-- (`supabase/data/import-real-restaurants.sql`), not through the self-onboarding
-- wizard. `apply_as_restaurant()` (mig 123) is the ONLY writer of
-- `public.merchant_staff` anywhere in the schema, and it always creates a NEW
-- draft restaurant for the caller — it cannot adopt a row that already exists.
-- Every other merchant_* function READS membership (`is_merchant_staff`,
-- `is_merchant_manager`, `my_merchant_ids`); none grants it. The table itself is
-- correctly locked (`authenticated` holds SELECT only, no INSERT), so there is
-- no client path either.
--
-- Result, verified in prod 2026-09-02: exactly ONE merchant_staff row exists and
-- it belongs to "Demo Kitchen (App Review)", which is `is_active = false`. Not a
-- single live venue has an account that can open the restaurant app or the
-- merchant dashboard. Combined with auto-accept (ON, 180s), the platform accepts
-- orders on behalf of kitchens that have no window into the system — which is how
-- order SE-PCG3EA reached `accepted` and sat unassigned for 27 days.
--
-- WHAT THIS DOES. One admin-gated RPC that links an ALREADY-REGISTERED user to an
-- ALREADY-EXISTING restaurant. It deliberately does NOT create auth accounts:
-- password/identity creation belongs to Supabase Auth and the merchant's own
-- signup, never to a definer function. The operator flow is therefore:
--
--   1. the merchant signs up themselves at merchant.sharmeats.online/signup
--      (or an admin invites them from the Supabase dashboard);
--   2. an admin calls this RPC with their email and the restaurant;
--   3. they can now open the kitchen app and see their queue.
--
-- Idempotent: re-linking the same pair updates the role rather than raising, so a
-- typo'd staff_role is fixable by re-running.
--
-- House rules: SECURITY DEFINER + pinned search_path; REVOKE from PUBLIC/anon
-- then grant `authenticated` only (the gate is inside, via require_admin()); role
-- checks fail closed through require_admin's coalesce; no new table; no
-- authority column gets a direct UPDATE grant. Fixed argument list — there is no
-- prior overload of this name to collide with (house rule 1).

-- ============================================================================
-- admin_link_merchant_staff(p_email, p_restaurant_id, p_staff_role)
-- ============================================================================
create or replace function public.admin_link_merchant_staff(
  p_email         text,
  p_restaurant_id uuid,
  p_staff_role    text default 'owner'
)
-- Output columns are prefixed `linked_*`. An unprefixed `profile_id` /
-- `restaurant_id` / `staff_role` here would shadow merchant_staff's own column
-- names inside the INSERT below, and Postgres rejects that as an ambiguous
-- column reference at RUNTIME, not at create time — the transaction-wrapped
-- rehearsal caught it; a structural-only check would not have.
returns table (
  linked_profile_id uuid,
  linked_restaurant uuid,
  restaurant_name   text,
  linked_staff_role text,
  previous_role     text
)
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_uid       uuid;
  v_email     text := lower(btrim(coalesce(p_email, '')));
  v_prev_role text;
  v_name      text;
begin
  -- Admin only, with the second factor when the account has one.
  perform public.require_admin();

  if p_staff_role is null or p_staff_role not in ('owner', 'manager', 'staff') then
    raise exception 'INVALID_STAFF_ROLE: expected owner, manager or staff'
      using errcode = 'check_violation';
  end if;

  if v_email = '' then
    raise exception 'EMAIL_REQUIRED' using errcode = 'check_violation';
  end if;

  -- The account must already exist. This function never creates one: auth
  -- identities and passwords are Supabase Auth's job, and minting them from a
  -- definer RPC would put credential creation behind a database call.
  select u.id into v_uid
    from auth.users u
   where lower(u.email) = v_email;

  if v_uid is null then
    raise exception 'USER_NOT_FOUND: % has no account yet — have them sign up at the merchant dashboard first', v_email
      using errcode = 'check_violation';
  end if;

  select r.name into v_name
    from public.restaurants r
   where r.id = p_restaurant_id;

  if v_name is null then
    raise exception 'RESTAURANT_NOT_FOUND' using errcode = 'check_violation';
  end if;

  -- Refuse to demote an admin into a merchant. An operator who is also a venue
  -- owner needs a separate account; silently flipping the role would strip their
  -- admin access on the next auth_role() lookup.
  select coalesce(u.role::text, '') into v_prev_role
    from public.users u
   where u.id = v_uid;

  if v_prev_role in ('admin', 'dispatcher') then
    raise exception 'REFUSING_TO_DEMOTE_OPERATOR: % is %; use a separate account for merchant access', v_email, v_prev_role
      using errcode = 'check_violation';
  end if;

  insert into public.merchant_staff (profile_id, restaurant_id, staff_role)
  values (v_uid, p_restaurant_id, p_staff_role)
  on conflict (profile_id, restaurant_id)
    do update set staff_role = excluded.staff_role;

  -- Same role flip apply_as_restaurant performs: merchant_staff is what the
  -- kitchen app's RLS reads. Customers keep ordering — the role governs which
  -- surfaces they can open, and a merchant account is not barred from the
  -- customer app.
  update public.users
     set role = 'merchant_staff', updated_at = now()
   where id = v_uid
     and coalesce(role::text, '') <> 'merchant_staff';

  return query
    select v_uid, p_restaurant_id, v_name, p_staff_role, v_prev_role;
end;
$function$;

revoke all on function public.admin_link_merchant_staff(text, uuid, text)
  from public, anon;
grant execute on function public.admin_link_merchant_staff(text, uuid, text)
  to authenticated;

comment on function public.admin_link_merchant_staff(text, uuid, text) is
  'Links an existing auth user to an existing restaurant as owner/manager/staff, '
  'flipping users.role to merchant_staff (the same pair apply_as_restaurant writes). '
  'Admin-gated via require_admin(); never creates auth accounts — the merchant signs '
  'up first. Idempotent on (profile_id, restaurant_id). Migration 223.';
