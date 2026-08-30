\set ON_ERROR_STOP on

-- Regression fixture for migration 220. The prior state models migration 218:
-- authenticated callers can read the exact queue projection, including
-- commission_pct, directly from restaurants. The security regression was that
-- anonymous Supabase sign-ins also run as authenticated.
begin;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin;
  end if;
end;
$$;

create schema if not exists auth;
grant usage on schema public to anon, authenticated;
grant usage on schema auth to anon, authenticated;

create table public.users (
  id uuid primary key,
  role text not null
);

create table auth.mfa_factors (
  user_id uuid not null,
  status text not null
);

create table public.restaurants (
  id uuid primary key,
  name text not null,
  zone text not null,
  phone text,
  created_at timestamptz not null default now(),
  onboarding_status text not null,
  onboarding_rejection_reason text,
  commission_pct numeric(5,2) not null,
  payout_iban text
);

-- Model the currently deployed, conditional-MFA require_admin(): it requires
-- aal2 only after an administrator enrolls. Migration 220 must add its own
-- strict MFA boundary so this sensitive reader is safe before the global MFA
-- hardening migration can be enabled for every existing administrator.
create function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;

create function public.auth_aal()
returns text
language sql
stable
as $$
  select nullif(current_setting('request.jwt.claim.aal', true), '');
$$;

create function public.has_verified_mfa_factor(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = auth, pg_temp
as $$
  select exists (
    select 1
      from auth.mfa_factors f
     where f.user_id = p_user_id
       and f.status = 'verified'
  );
$$;

revoke all on function public.has_verified_mfa_factor(uuid) from public, anon;
grant execute on function public.has_verified_mfa_factor(uuid) to authenticated;

create function public.require_admin()
returns void
language plpgsql
stable
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_role text;
begin
  if auth.uid() is null then
    raise exception 'AUTH_REQUIRED' using errcode = 'check_violation';
  end if;

  select role into v_role
    from public.users
   where id = auth.uid();

  if coalesce(v_role, '') <> 'admin' then
    raise exception 'NOT_AUTHORIZED' using errcode = 'check_violation';
  end if;

  if public.has_verified_mfa_factor(auth.uid())
     and coalesce(public.auth_aal(), '') <> 'aal2' then
    raise exception 'MFA_REQUIRED' using errcode = 'check_violation';
  end if;
end;
$$;

revoke all on function public.require_admin() from public, anon;
grant execute on function public.require_admin() to authenticated;

-- Model the narrowed column ACL that migration 218 left behind. In particular,
-- the direct authenticated commission grant is the vulnerability that 220
-- must remove without breaking the non-sensitive storefront/merchant fields.
revoke all on table public.restaurants from public, anon, authenticated;
grant select (
  id, name, zone, phone, created_at,
  onboarding_status, onboarding_rejection_reason, commission_pct
) on table public.restaurants to authenticated;
-- A historical table-wide PUBLIC grant must not survive the repair: such a
-- grant would make a subsequent column-level REVOKE ineffective for every
-- client role that inherits PUBLIC privileges.
grant select on table public.restaurants to public;

insert into public.users (id, role) values
  ('00000000-0000-0000-0000-000000000001', 'customer'),
  ('00000000-0000-0000-0000-000000000002', 'admin'),
  ('00000000-0000-0000-0000-000000000003', 'admin');

insert into auth.mfa_factors (user_id, status) values
  ('00000000-0000-0000-0000-000000000002', 'verified');

insert into public.restaurants (
  id, name, zone, phone, created_at,
  onboarding_status, onboarding_rejection_reason, commission_pct, payout_iban
) values
  (
    '10000000-0000-0000-0000-000000000001', 'Submitted Kitchen', 'Naama Bay',
    '+20-100', '2026-08-29 10:00:00+00', 'submitted', null, 12.50, 'EG12SECRET'
  ),
  (
    '10000000-0000-0000-0000-000000000002', 'Rejected Kitchen', 'Hadaba',
    '+20-200', '2026-08-29 11:00:00+00', 'rejected', 'Missing licence', 15.00, 'EG15SECRET'
  );

\ir ../migrations/220_restrict_restaurant_commission_read.sql

-- Direct Data API access: an anonymous Supabase session is an authenticated
-- PostgreSQL role, so it must not have a column grant for negotiated rates.
do $$
begin
  if has_column_privilege('authenticated', 'public.restaurants', 'commission_pct', 'SELECT') then
    raise exception 'authenticated can still directly read restaurants.commission_pct';
  end if;
  if has_column_privilege('anon', 'public.restaurants', 'commission_pct', 'SELECT') then
    raise exception 'anon can read restaurants.commission_pct';
  end if;
  if not has_column_privilege('authenticated', 'public.restaurants', 'onboarding_status', 'SELECT') then
    raise exception 'merchant application-status read was unintentionally removed';
  end if;
  if has_function_privilege('anon', 'public.admin_onboarding_queue(text)', 'EXECUTE') then
    raise exception 'anon can execute admin_onboarding_queue';
  end if;
  if not has_function_privilege('authenticated', 'public.admin_onboarding_queue(text)', 'EXECUTE') then
    raise exception 'authenticated lost the authenticated-only admin RPC grant';
  end if;
end;
$$;

-- A customer (including an anonymous authenticated app session) cannot call
-- the queue RPC and cannot bypass it with a direct column projection.
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001';
set local request.jwt.claim.aal = 'aal2';

do $$
begin
  perform * from public.admin_onboarding_queue('submitted');
  raise exception 'customer unexpectedly called admin_onboarding_queue';
exception
  when check_violation then
    if sqlerrm <> 'NOT_AUTHORIZED' then
      raise;
    end if;
end;
$$;

do $$
begin
  perform commission_pct from public.restaurants;
  raise exception 'customer unexpectedly read restaurants.commission_pct';
exception
  when insufficient_privilege then
    null;
end;
$$;

reset role;

-- A currently unenrolled admin is still accepted by the deployed central
-- gate. The new queue must deny that session explicitly; otherwise its
-- "MFA-gated" label would be false until the global hardening can be enabled.
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000003';
set local request.jwt.claim.aal = 'aal1';

do $$
begin
  perform * from public.admin_onboarding_queue('submitted');
  raise exception 'unenrolled admin unexpectedly called admin_onboarding_queue';
exception
  when check_violation then
    if sqlerrm <> 'MFA_ENROLLMENT_REQUIRED: admin onboarding access requires a verified second factor' then
      raise;
    end if;
end;
$$;

reset role;

-- Password-only admins remain blocked by the same authority gate used by all
-- other admin RPCs; the new SECURITY DEFINER reader cannot become an MFA bypass.
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000002';
set local request.jwt.claim.aal = 'aal1';

do $$
begin
  perform * from public.admin_onboarding_queue('submitted');
  raise exception 'aal1 admin unexpectedly called admin_onboarding_queue';
exception
  when check_violation then
    if sqlerrm <> 'MFA_REQUIRED' then
      raise;
    end if;
end;
$$;

reset role;

-- A verified aal2 admin can still read exactly the queue data, filtered and
-- ordered as the onboarding dashboard expects.
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000002';
set local request.jwt.claim.aal = 'aal2';

do $$
declare
  v_count integer;
  v_rate numeric;
  v_name text;
begin
  select count(*), min(commission_pct), min(name)
    into v_count, v_rate, v_name
    from public.admin_onboarding_queue('submitted');

  if v_count <> 1 or v_rate <> 12.50 or v_name <> 'Submitted Kitchen' then
    raise exception 'admin queue did not return the submitted restaurant correctly';
  end if;

  select count(*) into v_count
    from public.admin_onboarding_queue('rejected');
  if v_count <> 1 then
    raise exception 'admin queue did not return rejected restaurants';
  end if;
end;
$$;

do $$
begin
  perform * from public.admin_onboarding_queue('live');
  raise exception 'invalid onboarding status unexpectedly succeeded';
exception
  when check_violation then
    if sqlerrm <> 'INVALID_ONBOARDING_STATUS' then
      raise;
    end if;
end;
$$;

reset role;
rollback;
