-- 220 — remove negotiated merchant commission rates from the client table
-- projection while preserving the admin onboarding queue through a narrowly
-- scoped, MFA-gated RPC.
--
-- Migration 218 correctly removed payout data from the customer storefront,
-- but left commission_pct readable by every `authenticated` caller because the
-- admin dashboard selected its onboarding queue directly from restaurants.
-- Supabase anonymous sign-ins use the authenticated PostgreSQL role, so this
-- exposed every visible merchant's negotiated rate to a normal app session.
--
-- RLS cannot solve a column disclosure where the storefront must still expose
-- the same rows. Revoke the one direct column grant and return it only from an
-- exact-projection SECURITY DEFINER function after the central MFA-aware admin
-- authority gate succeeds. The public function is intentionally an RPC rather
-- than a view: views need separate security-invoker/version handling and would
-- still need an admin RLS policy to reveal submitted/rejected rows.

-- Remove all inherited client paths to the rate. A table-level PUBLIC grant
-- beats any column-level revocation, so clear that legacy/default path before
-- revoking the authenticated column grant left by migration 218.
revoke select on table public.restaurants from public;
revoke select (commission_pct)
  on table public.restaurants
  from public, anon, authenticated;

-- This is a new fixed signature. Do not add an overload: PostgREST resolves
-- RPCs by argument shape and ambiguous overloads fail every dashboard call.
create function public.admin_onboarding_queue(p_status text)
returns table (
  id uuid,
  name text,
  zone text,
  phone text,
  created_at timestamptz,
  onboarding_status text,
  onboarding_rejection_reason text,
  commission_pct numeric
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $function$
begin
  -- require_admin() verifies the stored role. Production is intentionally
  -- still on its conditional-MFA version until every existing admin enrolls,
  -- so this high-sensitivity reader must enforce its own live-factor + aal2
  -- boundary rather than inheriting the temporary password-only exception.
  -- Calling the checks inside the definer function prevents this reader from
  -- becoming a password-only-admin or authenticated-customer bypass.
  perform public.require_admin();

  if not public.has_verified_mfa_factor(auth.uid()) then
    raise exception 'MFA_ENROLLMENT_REQUIRED: admin onboarding access requires a verified second factor'
      using errcode = 'check_violation';
  end if;

  if coalesce(public.auth_aal(), '') <> 'aal2' then
    raise exception 'MFA_REQUIRED: admin onboarding access requires a verified second factor'
      using errcode = 'check_violation';
  end if;

  if coalesce(p_status, '') not in ('submitted', 'rejected') then
    raise exception 'INVALID_ONBOARDING_STATUS' using errcode = 'check_violation';
  end if;

  return query
  select
    r.id,
    r.name,
    r.zone::text,
    r.phone,
    r.created_at,
    r.onboarding_status,
    r.onboarding_rejection_reason,
    r.commission_pct
  from public.restaurants r
  where r.onboarding_status = p_status
  order by r.created_at asc;
end;
$function$;

comment on function public.admin_onboarding_queue(text) is
  'MFA-verified admin onboarding queue. The exact projection is the sole client-facing path to restaurants.commission_pct; ordinary authenticated sessions must not receive negotiated merchant rates. Mig 220.';

comment on column public.restaurants.commission_pct is
  'Platform commission for this merchant. NOT readable directly by PUBLIC, anon, or authenticated; MFA-verified admins use admin_onboarding_queue and merchant apps use my_restaurant_tier. Migs 218, 220.';

-- New functions have PUBLIC EXECUTE by default on PostgreSQL. Revoke before
-- granting the dashboard's authenticated transport role; authorization remains
-- enforced by require_admin() in the body.
revoke all on function public.admin_onboarding_queue(text)
  from public, anon, authenticated, service_role;
grant execute on function public.admin_onboarding_queue(text)
  to authenticated;

-- Fail the migration immediately if a future edit restores the direct
-- disclosure or weakens the deliberate RPC boundary.
do $assertions$
begin
  if has_column_privilege('public', 'public.restaurants', 'commission_pct', 'SELECT')
     or has_column_privilege('anon', 'public.restaurants', 'commission_pct', 'SELECT')
     or has_column_privilege('authenticated', 'public.restaurants', 'commission_pct', 'SELECT') then
    raise exception '[220] client role can still read restaurants.commission_pct directly';
  end if;

  if has_function_privilege('public', 'public.admin_onboarding_queue(text)', 'EXECUTE')
     or has_function_privilege('anon', 'public.admin_onboarding_queue(text)', 'EXECUTE') then
    raise exception '[220] unauthenticated caller can execute admin_onboarding_queue';
  end if;

  if not has_function_privilege('authenticated', 'public.admin_onboarding_queue(text)', 'EXECUTE') then
    raise exception '[220] admin-web transport role lost admin_onboarding_queue execution';
  end if;
end;
$assertions$;
