-- 124_signup_role_hint_lockdown.sql
-- CRITICAL: signup can no longer self-assign a role via client-controlled auth metadata.
--
-- What: public.handle_new_auth_user() (latest body: 007_roles_merchant_staff.sql
-- lines 85-101; mig 122 only re-pinned its search_path) inserted
-- public.users.role from coalesce((new.raw_user_meta_data->>'role')::app_role, 'customer').
--
-- Why this is exploitable: new.raw_user_meta_data is the auth signup metadata
-- payload, and it is CLIENT-CONTROLLED. Both supabase-js `auth.signUp({..,
-- options: { data: {...} }})` and `auth.signInAnonymously({ options: { data:
-- {...} }})` let ANY caller holding only the public anon key set arbitrary keys
-- in that payload, including `role`. Because the trigger cast that value
-- straight into public.users.role, any anonymous caller could mint themselves
-- role='admin' (or 'dispatcher', 'driver', 'merchant_staff') at the moment of
-- signup — full privilege escalation with no authentication beyond the anon
-- key. Verified live in prod 2026-07-24.
--
-- Why this ships now: restaurant self-onboarding (mig 123) makes public signup
-- a first-class, marketed flow (previously merchant accounts were mostly
-- ops-provisioned), which meaningfully widens exposure to this hole in the
-- same branch — so it lands as part of the same release rather than trailing
-- behind it.
--
-- Historical audit (2026-07-24, live): the ONLY account ever created via the
-- role hint is the App Review demo merchant (deliberate, ops-created,
-- 2026-07-21) — no admin/dispatcher was ever minted this way. Ops-created
-- accounts (drivers, dispatchers, admins, merchant staff) go through
-- server-side role updates after signup (e.g. mig 123's apply_as_restaurant
-- flips customer -> merchant_staff inside a SECURITY DEFINER RPC with its own
-- fail-closed eligibility check) — nothing legitimate depends on the hint.
--
-- Fix: the signup trigger now hardcodes role = 'customer' for every new
-- public.users row, full stop. All benign personalization fields
-- (display_name, locale, preferred_currency, phone) are left exactly as they
-- were — those are not privilege-bearing. Role changes happen exclusively via
-- server-side RPCs/ops tooling after signup.
--
-- Also: lock down execute on the trigger function itself. It has always been
-- trigger-only (invoked by `on_auth_user_created`, never called directly by
-- app code), but like every SECURITY DEFINER function before the mig 081/084
-- hardening sweep, it never had its default PUBLIC/anon/authenticated execute
-- grant revoked. Revoking here also clears two standing Supabase
-- security-advisor WARNs for this function.
--
-- No signature change: zero args, `returns trigger`, matches every prior
-- definition (002, 007, 122) — CREATE OR REPLACE is safe, no second overload.
--
-- Forward-only: no down-migration. Non-destructive (function body swap +
-- revoke); does not touch data.

create or replace function public.handle_new_auth_user() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  insert into public.users (id, phone, display_name, locale, preferred_currency, role)
  values (
    new.id,
    coalesce(new.phone, ''),
    coalesce(new.raw_user_meta_data->>'display_name', 'Guest'),
    coalesce((new.raw_user_meta_data->>'locale')::locale_type, 'ar'),
    coalesce((new.raw_user_meta_data->>'preferred_currency')::currency_type, 'EGP'),
    'customer'::app_role  -- role is NEVER client-assignable; server-side RPCs/ops flip roles post-signup
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

revoke all on function public.handle_new_auth_user() from public, anon, authenticated;
