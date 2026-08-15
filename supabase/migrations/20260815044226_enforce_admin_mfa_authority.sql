-- 20260815044226_enforce_admin_mfa_authority.sql
--
-- Make MFA an authority boundary for the admin role, not a dashboard prompt.
--
-- Migration 202 introduced require_admin(), but deliberately allowed an admin
-- without a verified factor to continue at aal1. It also left the hundreds of
-- existing RLS/storage policy and mixed admin/dispatcher checks untouched.
-- The result was a complete bypass: an aal1 token still made auth_role() return
-- `admin`, so every existing `auth_role() = 'admin'` branch remained open.
--
-- The durable fix belongs in auth_role(), the recursion-safe helper already
-- used by those policies and RPCs. For an admin identity it exposes authority
-- only when Supabase's verified JWT carries aal2. Other roles are returned
-- unchanged, so dispatcher, merchant, driver and customer paths do not narrow.
-- Existing function bodies inherit the fix without being copied here (house
-- rule 2: copying dozens of bodies would risk reverting later hardening).

create or replace function private.admin_mfa_satisfied(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select p_user_id is not null
     and p_user_id = auth.uid()
     and coalesce(public.auth_aal(), '') = 'aal2'
     and public.has_verified_mfa_factor(p_user_id);
$$;

comment on function private.admin_mfa_satisfied(uuid) is
  'True only when p_user_id is the current JWT subject, the JWT is aal2, and that account still has a verified factor. Internal building block for every admin authority chain; checking the live factor closes stale aal2 JWTs after unenrollment. Mig 20260815044226.';

revoke all on function private.admin_mfa_satisfied(uuid)
  from public, anon, authenticated;

-- This predicate accepts an arbitrary user id and is now purely an internal
-- building block. Do not leave MFA-enrollment enumeration on the Data API.
revoke all on function public.has_verified_mfa_factor(uuid)
  from public, anon, authenticated;
grant execute on function public.has_verified_mfa_factor(uuid) to service_role;

comment on function public.has_verified_mfa_factor(uuid) is
  'Internal/service predicate for a currently verified MFA factor. Client execution is revoked because an arbitrary user-id argument would expose MFA-enrollment posture. Admin authority now requires this predicate AND aal2; unenrolled admins receive no privileged authority. Migs 202, 20260815044226.';

create or replace function public.auth_role()
returns public.app_role
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select case
    when u.role = 'admin'::public.app_role
         and not private.admin_mfa_satisfied(u.id)
      then null::public.app_role
    else u.role
  end
  from public.users u
  where u.id = auth.uid();
$$;

comment on function public.auth_role() is
  'Recursion-safe coarse-role lookup and the central admin MFA authority gate. Admin is returned only for an aal2 JWT backed by a currently verified factor; aal1/missing AAL/no factor returns NULL. Dispatcher, merchant_staff, driver and customer are unchanged. Every role-based RPC/RLS/storage policy inherits this rule. Mig 20260815044226.';

-- PUBLIC receives EXECUTE on new functions by default. Revoke it, then grant
-- only the roles that need this policy helper. anon is explicit because public
-- catalog policies contain an auth_role() branch even though it returns NULL
-- without an authenticated uid.
revoke all on function public.auth_role() from public;
grant execute on function public.auth_role() to anon, authenticated, service_role;

-- require_admin() remains useful in pure-admin SECURITY DEFINER RPCs. Make its
-- contract explicit and mandatory: raw stored role must be admin AND the
-- current JWT must be aal2. Do not call auth_role() for the first comparison,
-- because auth_role() intentionally masks an aal1 admin and would turn the
-- actionable MFA_REQUIRED response into a generic NOT_AUTHORIZED response.
create or replace function public.require_admin()
returns void
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := auth.uid();
  v_stored_role public.app_role;
begin
  if v_user is null then
    raise exception 'AUTH_REQUIRED' using errcode = 'check_violation';
  end if;

  select u.role
    into v_stored_role
    from public.users u
   where u.id = v_user;

  if coalesce(v_stored_role::text, '') <> 'admin' then
    raise exception 'NOT_AUTHORIZED' using errcode = 'check_violation';
  end if;

  if not public.has_verified_mfa_factor(v_user) then
    raise exception 'MFA_ENROLLMENT_REQUIRED: admin authority requires a verified second factor'
      using errcode = 'check_violation';
  end if;

  if coalesce(public.auth_aal(), '') <> 'aal2' then
    raise exception 'MFA_REQUIRED: admin authority requires a verified second factor'
      using errcode = 'check_violation';
  end if;
end;
$$;

comment on function public.require_admin() is
  'Mandatory admin authority gate: stored role = admin, a currently verified factor exists, AND the current Supabase JWT aal = aal2. An unenrolled or password-only admin is denied and must enroll/verify TOTP through the security route. Mig 20260815044226.';

revoke all on function public.require_admin() from public, anon;
grant execute on function public.require_admin() to authenticated, service_role;

comment on function public.admin_mfa_posture() is
  'Every admin account and whether it has a verified second factor. has_factor = false now means the account is denied all admin authority until enrollment; a leaked password alone is insufficient. Migs 202, 20260815044226.';

-- auth_role() now returns NULL for an admin session that has not satisfied MFA.
-- Most current RPC guards already coalesce that value and therefore fail
-- closed. Two surviving mixed-authority bodies predate that house rule:
--
--   record_cash_handin:    auth_role() NOT IN (admin, dispatcher)
--   restaurant_scorecard: NOT (auth_role() = admin OR merchant-staff)
--
-- A NULL condition is not true in PL/pgSQL, so both old denial guards would be
-- skipped by precisely the aal1 admin this migration masks. Patch the DEPLOYED
-- bodies in place rather than copying historical versions: this retains every
-- later body change while making the existing dispatcher/merchant branches
-- explicit and fail-closed.
do $admin_mfa_mixed_guards$
declare
  v_name text;
  v_count integer;
  v_source text;
  v_rewritten text;
  v_old text;
  v_new text;
begin
  foreach v_name in array array['record_cash_handin', 'restaurant_scorecard']
  loop
    select count(*)
      into v_count
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname = v_name;

    if v_count <> 1 then
      raise exception
        '20260815044226: expected exactly one public.% overload, found %',
        v_name, v_count;
    end if;

    select pg_get_functiondef(p.oid)
      into v_source
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname = v_name;

    if v_name = 'record_cash_handin' then
      v_old := 'if (select public.auth_role()) not in (''admin'',''dispatcher'') then';
      v_new := 'if coalesce((select public.auth_role())::text, '''') not in (''admin'',''dispatcher'') then';
    else
      v_old := 'if not (public.auth_role() = ''admin'' or public.is_merchant_staff(p_restaurant_id)) then';
      v_new := 'if not (coalesce(public.auth_role()::text, '''') = ''admin'' or public.is_merchant_staff(p_restaurant_id)) then';
    end if;

    if (length(v_source) - length(replace(v_source, v_old, ''))) / length(v_old) <> 1 then
      raise exception
        '20260815044226: expected exactly one legacy NULL guard in public.%; deployed body differs',
        v_name;
    end if;

    v_rewritten := replace(v_source, v_old, v_new);
    execute v_rewritten;
  end loop;
end
$admin_mfa_mixed_guards$;

-- CREATE OR REPLACE preserves ACLs, but restate the intended Data API surface
-- explicitly (house rule 3). These remain mixed-role client RPCs—not admin-only
-- RPCs—so authenticated dispatchers and merchants keep their legitimate path.
revoke all on function public.record_cash_handin(uuid, integer, text, text)
  from public, anon;
grant execute on function public.record_cash_handin(uuid, integer, text, text)
  to authenticated;

revoke all on function public.restaurant_scorecard(uuid, integer)
  from public, anon;
grant execute on function public.restaurant_scorecard(uuid, integer)
  to authenticated;

comment on function public.record_cash_handin(uuid, integer, text, text) is
  'ADMIN/DISPATCHER cash reconciliation. The mixed-role guard is NULL-safe so an admin masked by the mandatory MFA authority gate cannot bypass it; dispatcher authority is unchanged. Migs 104, 20260815044226.';

comment on function public.restaurant_scorecard(uuid, integer) is
  'Per-restaurant scorecard for an aal2 admin or that restaurant''s merchant staff. Its mixed admin/merchant guard is NULL-safe under the mandatory admin MFA authority gate. Migs 077, 20260815044226.';

-- The production platform owner seeded by migration 187 is also an admin.
-- Platform ownership/capabilities intentionally do not derive from role, but
-- they still must not become a second path around MFA for that admin identity.
-- Preserve machine/background inspection: only a predicate about the CURRENT
-- JWT subject is session authority and therefore subject to the MFA check.

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
      join public.users u on u.id = o.user_id
     where o.user_id = p_user_id
       and o.status = 'active'
       and coalesce(u.is_blocked, false) = false
       and (
         u.role <> 'admin'::public.app_role
         or p_user_id is distinct from auth.uid()
         or private.admin_mfa_satisfied(p_user_id)
       )
  );
$function$;

comment on function public.is_platform_owner(uuid) is
  'Root platform-owner predicate with live-identity/block checks from mig 159 plus mandatory MFA when the current JWT subject is an admin. Machine/background inspection about another identity is unchanged. Mig 20260815044226.';

revoke all on function public.is_platform_owner(uuid) from public, anon, authenticated;
grant execute on function public.is_platform_owner(uuid) to service_role;

create or replace function public.has_platform_capability(
  p_user_id uuid,
  p_capability text
)
returns boolean
language sql
stable
security definer
set search_path to 'public', 'private', 'pg_temp'
as $function$
  select exists (
    select 1
      from private.platform_operator_capabilities c
      join public.users u on u.id = c.user_id
     where c.user_id = p_user_id
       and c.capability = p_capability
       and c.status = 'active'
       and coalesce(u.is_blocked, false) = false
       and (c.expires_at is null or c.expires_at > now())
       and (
         u.role <> 'admin'::public.app_role
         or p_user_id is distinct from auth.uid()
         or private.admin_mfa_satisfied(p_user_id)
       )
  );
$function$;

comment on function public.has_platform_capability(uuid, text) is
  'Active/unexpired platform capability with live-identity/block checks from mig 159 plus mandatory MFA when the current JWT subject is an admin. Machine/background inspection about another identity is unchanged. Mig 20260815044226.';

revoke all on function public.has_platform_capability(uuid, text) from public, anon, authenticated;
-- Mig 159 intentionally made this arbitrary-subject form service-only and
-- exposed i_have_platform_capability(text) to clients. Preserve that boundary:
-- granting this form to authenticated would re-open operator-roster probing.
grant execute on function public.has_platform_capability(uuid, text) to service_role;

-- Mutation paths use the locking owner assertion rather than the stable read
-- predicate. Start from migration 166's latest body and add the same current-
-- admin MFA condition after both authority rows are established.
create or replace function public.assert_platform_owner_locked(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public', 'private', 'pg_temp'
as $function$
declare
  v_status  text;
  v_role    public.app_role;
  v_blocked boolean;
begin
  select o.status
    into v_status
    from private.platform_owners o
   where o.user_id = p_user_id
   for update;

  if not found or v_status is distinct from 'active' then
    raise exception 'NOT_PLATFORM_OWNER' using errcode = 'check_violation';
  end if;

  select u.role, coalesce(u.is_blocked, false)
    into v_role, v_blocked
    from public.users u
   where u.id = p_user_id;

  if not found or v_blocked then
    raise exception 'NOT_PLATFORM_OWNER' using errcode = 'check_violation';
  end if;

  if v_role = 'admin'::public.app_role
     and p_user_id is not distinct from auth.uid()
     and not private.admin_mfa_satisfied(p_user_id) then
    raise exception 'MFA_REQUIRED: platform-owner authority requires a verified second factor'
      using errcode = 'check_violation';
  end if;
end;
$function$;

comment on function public.assert_platform_owner_locked(uuid) is
  'Establishes live platform ownership under the canonical owner-row lock (mig 166) and requires live aal2 MFA when the acting identity is an admin (mig 20260815044226). Machine/background assertions about another identity are unchanged.';

revoke all on function public.assert_platform_owner_locked(uuid) from public, anon, authenticated;
-- Internal-only, matching mig 166: authenticated owner-management RPCs invoke
-- this as their SECURITY DEFINER owner; no Data API role calls it directly.
