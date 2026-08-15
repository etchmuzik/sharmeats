\set ON_ERROR_STOP on

begin;

do $roles$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin; end if;
end
$roles$;

create schema auth;
create schema private;
create type public.app_role as enum ('customer','driver','merchant_staff','dispatcher','admin');

create function auth.uid()
returns uuid
language sql
stable
as $$
  select (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')::uuid
$$;

-- The smallest production-faithful identity/MFA slice. The definitions below
-- are the pre-fix versions from migrations 007 and 202; including the new
-- migration must replace them without adding overloads.
create table public.users (
  id uuid primary key,
  role public.app_role not null,
  is_blocked boolean not null default false
);
create table auth.users (
  id uuid primary key,
  email text,
  last_sign_in_at timestamptz
);
create table auth.mfa_factors (
  id uuid primary key,
  user_id uuid not null,
  status text not null
);

create function public.auth_aal()
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'aal'
$$;

create function public.auth_role()
returns public.app_role
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select role from public.users where id = auth.uid()
$$;

create function public.has_verified_mfa_factor(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = auth, public, pg_temp
as $$
  select exists (
    select 1 from auth.mfa_factors
    where user_id = p_user_id and status = 'verified'
  )
$$;

create function public.require_admin()
returns void
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then
    raise exception 'AUTH_REQUIRED' using errcode = 'check_violation';
  end if;
  if coalesce(public.auth_role()::text, '') <> 'admin' then
    raise exception 'NOT_AUTHORIZED' using errcode = 'check_violation';
  end if;
  if public.has_verified_mfa_factor(v_user)
     and coalesce(public.auth_aal(), '') <> 'aal2' then
    raise exception 'MFA_REQUIRED' using errcode = 'check_violation';
  end if;
end
$$;

create function public.admin_mfa_posture()
returns table (user_id uuid, email text, has_factor boolean, last_sign_in timestamptz)
language plpgsql
stable
security definer
set search_path = public, auth, pg_temp
as $$
begin
  perform public.require_admin();
  return query
  select u.id, au.email, public.has_verified_mfa_factor(u.id), au.last_sign_in_at
  from public.users u
  join auth.users au on au.id = u.id
  where u.role = 'admin'::public.app_role;
end
$$;

-- The real platform owner is also the real admin (migration 187). These are
-- the latest pre-fix predicate/locking shapes from migrations 159 and 166, so
-- the test catches an aal1 bypass through capability authority as well as the
-- ordinary admin role.
create table private.platform_owners (
  user_id uuid primary key,
  status text not null
);
create table private.platform_operator_capabilities (
  user_id uuid not null,
  capability text not null,
  status text not null,
  expires_at timestamptz
);

create function public.is_platform_owner(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, private, pg_temp
as $$
  select exists (
    select 1
    from private.platform_owners o
    join public.users u on u.id = o.user_id
    where o.user_id = p_user_id
      and o.status = 'active'
      and coalesce(u.is_blocked, false) = false
  )
$$;

create function public.has_platform_capability(p_user_id uuid, p_capability text)
returns boolean
language sql
stable
security definer
set search_path = public, private, pg_temp
as $$
  select exists (
    select 1
    from private.platform_operator_capabilities c
    join public.users u on u.id = c.user_id
    where c.user_id = p_user_id
      and c.capability = p_capability
      and c.status = 'active'
      and coalesce(u.is_blocked, false) = false
      and (c.expires_at is null or c.expires_at > now())
  )
$$;

create function public.assert_platform_owner_locked(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
declare
  v_status text;
begin
  select status into v_status
  from private.platform_owners
  where user_id = p_user_id
  for update;
  if not found or v_status is distinct from 'active' then
    raise exception 'NOT_PLATFORM_OWNER' using errcode = 'check_violation';
  end if;
  if not exists (
    select 1 from public.users
    where id = p_user_id and coalesce(is_blocked, false) = false
  ) then
    raise exception 'NOT_PLATFORM_OWNER' using errcode = 'check_violation';
  end if;
end
$$;

-- Representative production policy shapes. They prove that correcting the
-- shared role helper closes both pure-admin and mixed admin/dispatcher paths
-- while leaving self/staff paths intact.
create table public.ops_orders (id uuid primary key);
create table public.kyc_documents (id uuid primary key, user_id uuid not null);
create table public.merchant_catalog (id uuid primary key, staff_user_id uuid not null);
create table public.merchant_memberships (
  restaurant_id uuid not null,
  staff_user_id uuid not null
);
alter table public.ops_orders enable row level security;
alter table public.kyc_documents enable row level security;
alter table public.merchant_catalog enable row level security;

create policy ops_orders_admin_dispatcher_read on public.ops_orders for select to authenticated
  using ((select public.auth_role()) in ('admin', 'dispatcher'));
create policy kyc_own_or_admin_read on public.kyc_documents for select to authenticated
  using (user_id = (select auth.uid()) or (select public.auth_role()) = 'admin');
create policy merchant_catalog_staff_or_admin_read on public.merchant_catalog for select to authenticated
  using (staff_user_id = (select auth.uid()) or (select public.auth_role()) = 'admin');

create function public.is_merchant_staff(p_restaurant_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.merchant_memberships m
    where m.restaurant_id = p_restaurant_id
      and m.staff_user_id = auth.uid()
  )
$$;

-- Existing RPC bodies use these exact role shapes. They are intentionally
-- created before the migration: if the shared gate is correct, old and future
-- callers inherit it without risky function-body rewrites.
create function public.test_admin_rpc()
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.require_admin();
  return 'ok';
end
$$;

create function public.test_admin_dispatcher_rpc()
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if coalesce(public.auth_role()::text, '') not in ('admin', 'dispatcher') then
    raise exception 'NOT_AUTHORIZED' using errcode = 'check_violation';
  end if;
  return 'ok';
end
$$;

-- Two current production RPCs predate the repository's fail-closed role-check
-- house rule. Once auth_role() masks an aal1 admin to NULL, these exact guards
-- become bypasses because PL/pgSQL treats a NULL IF condition as false. The MFA
-- migration must patch the latest deployed bodies in place while preserving
-- dispatcher and merchant paths.
create function public.record_cash_handin(
  p_driver_id uuid,
  p_amount_egp int,
  p_reason text default 'hand_in',
  p_note text default null
)
returns int
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if (select public.auth_role()) not in ('admin','dispatcher') then
    raise exception 'NOT_AUTHORIZED' using errcode = 'check_violation';
  end if;
  return p_amount_egp;
end
$$;

create function public.restaurant_scorecard(
  p_restaurant_id uuid,
  p_days int default 30
)
returns table (
  restaurant_id uuid,
  window_days int,
  orders int,
  accepted int,
  rejected int,
  cancelled int,
  delivered int,
  acceptance_rate numeric,
  reject_rate numeric,
  cancel_rate numeric,
  on_time_rate numeric,
  avg_prep_minutes numeric,
  avg_food_rating numeric
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if not (public.auth_role() = 'admin' or public.is_merchant_staff(p_restaurant_id)) then
    raise exception 'NOT_AUTHORIZED' using errcode = 'check_violation';
  end if;
  return query select
    p_restaurant_id, greatest(1, coalesce(p_days, 30)),
    0, 0, 0, 0, 0,
    null::numeric, null::numeric, null::numeric,
    null::numeric, null::numeric, null::numeric;
end
$$;

create function public.test_platform_owner_rpc()
returns text
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
begin
  if not public.is_platform_owner(auth.uid()) then
    raise exception 'NOT_PLATFORM_OWNER' using errcode = 'check_violation';
  end if;
  perform public.assert_platform_owner_locked(auth.uid());
  return 'ok';
end
$$;

create function public.test_platform_capability_rpc()
returns text
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
begin
  if not public.has_platform_capability(auth.uid(), 'expansion_launch_manager') then
    raise exception 'NOT_AUTHORIZED' using errcode = 'check_violation';
  end if;
  return 'ok';
end
$$;

grant usage on schema public, auth to authenticated;
grant select on public.users, public.ops_orders, public.kyc_documents,
  public.merchant_catalog, public.merchant_memberships to authenticated;
grant execute on function auth.uid(), public.auth_aal(), public.auth_role(),
  public.has_verified_mfa_factor(uuid), public.require_admin(),
  public.admin_mfa_posture(),
  public.test_admin_rpc(), public.test_admin_dispatcher_rpc(),
  public.test_platform_owner_rpc(), public.test_platform_capability_rpc(),
  public.is_merchant_staff(uuid),
  public.record_cash_handin(uuid, int, text, text),
  public.restaurant_scorecard(uuid, int) to authenticated;

\ir ../migrations/20260815044226_enforce_admin_mfa_authority.sql

do $$
declare
  v_name text;
  v_schema text;
  v_count integer;
begin
  foreach v_name in array array[
    'auth_role',
    'require_admin',
    'admin_mfa_posture',
    'is_platform_owner',
    'has_platform_capability',
    'assert_platform_owner_locked',
    'record_cash_handin',
    'restaurant_scorecard'
  ] loop
    select count(*) into v_count
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = v_name;
    if v_count <> 1 then
      raise exception '% has % overloads; expected exactly one', v_name, v_count;
    end if;
  end loop;

  v_schema := 'private';
  v_name := 'admin_mfa_satisfied';
  select count(*) into v_count
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = v_schema and p.proname = v_name;
  if v_count <> 1 then
    raise exception '%.% has % overloads; expected exactly one', v_schema, v_name, v_count;
  end if;

  -- Mig 159 deliberately replaced the arbitrary-subject client predicate with
  -- i_have_platform_capability(text). Replacing the predicate body here must
  -- not silently resurrect authenticated roster enumeration.
  if has_function_privilege(
    'authenticated',
    'public.has_platform_capability(uuid,text)',
    'EXECUTE'
  ) then
    raise exception 'authenticated can execute arbitrary-subject platform capability predicate';
  end if;
  if has_function_privilege(
    'service_role',
    'public.assert_platform_owner_locked(uuid)',
    'EXECUTE'
  ) then
    raise exception 'service_role can directly execute internal platform-owner lock assertion';
  end if;
end
$$;

insert into public.users (id, role) values
  ('a0000000-0000-0000-0000-000000000001', 'admin'),
  ('d0000000-0000-0000-0000-000000000001', 'dispatcher'),
  ('c0000000-0000-0000-0000-000000000001', 'customer'),
  ('e0000000-0000-0000-0000-000000000001', 'merchant_staff');
insert into auth.users (id, email) values
  ('a0000000-0000-0000-0000-000000000001', 'admin@example.test');
insert into private.platform_owners (user_id, status) values
  ('a0000000-0000-0000-0000-000000000001', 'active');
insert into private.platform_operator_capabilities (user_id, capability, status) values
  ('a0000000-0000-0000-0000-000000000001', 'expansion_launch_manager', 'active');
insert into public.ops_orders values ('10000000-0000-0000-0000-000000000001');
insert into public.kyc_documents values
  ('20000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000001');
insert into public.merchant_catalog values
  ('30000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000001');
insert into public.merchant_memberships values
  ('40000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000001');

-- Admin with password only: DENIED even before enrollment. This is the
-- negative control the old optional-factor helper failed.
select set_config(
  'request.jwt.claims',
  '{"sub":"a0000000-0000-0000-0000-000000000001","aal":"aal1"}',
  true
);
set local role authenticated;

do $$
begin
  if public.auth_role() is not null then
    raise exception 'aal1 admin retained the admin role';
  end if;
  begin
    perform public.test_admin_rpc();
    raise exception 'aal1 admin called an admin RPC';
  exception when check_violation then null;
  end;
  begin
    perform public.test_admin_dispatcher_rpc();
    raise exception 'aal1 admin called a mixed admin/dispatcher RPC';
  exception when check_violation then null;
  end;
  begin
    perform public.record_cash_handin(
      '50000000-0000-0000-0000-000000000001', 100, 'hand_in', null
    );
    raise exception 'aal1 admin bypassed the legacy admin/dispatcher NULL guard';
  exception when check_violation then null;
  end;
  begin
    perform public.restaurant_scorecard(
      '40000000-0000-0000-0000-000000000002', 30
    );
    raise exception 'aal1 admin bypassed the legacy admin/merchant NULL guard';
  exception when check_violation then null;
  end;
  begin
    perform public.test_platform_owner_rpc();
    raise exception 'aal1 admin retained platform-owner authority';
  exception when check_violation then null;
  end;
  begin
    perform public.test_platform_capability_rpc();
    raise exception 'aal1 admin retained platform capability authority';
  exception when check_violation then null;
  end;
  if (select count(*) from public.ops_orders) <> 0 then
    raise exception 'aal1 admin read the mixed ops policy';
  end if;
  if (select count(*) from public.kyc_documents) <> 0 then
    raise exception 'aal1 admin read another user''s KYC row';
  end if;
end
$$;

reset role;

-- Admin with aal2: all admin authority is restored.
insert into auth.mfa_factors (id, user_id, status) values (
  'f0000000-0000-0000-0000-000000000001',
  'a0000000-0000-0000-0000-000000000001',
  'verified'
);
select set_config(
  'request.jwt.claims',
  '{"sub":"a0000000-0000-0000-0000-000000000001","aal":"aal2"}',
  true
);
set local role authenticated;

do $$
begin
  if public.auth_role() is distinct from 'admin'::public.app_role then
    raise exception 'aal2 admin did not retain the admin role';
  end if;
  if public.test_admin_rpc() <> 'ok' or public.test_admin_dispatcher_rpc() <> 'ok' then
    raise exception 'aal2 admin could not call privileged RPCs';
  end if;
  if public.record_cash_handin(
    '50000000-0000-0000-0000-000000000001', 100, 'hand_in', null
  ) <> 100 then
    raise exception 'aal2 admin lost cash-reconciliation authority';
  end if;
  perform public.restaurant_scorecard(
    '40000000-0000-0000-0000-000000000002', 30
  );
  if public.test_platform_owner_rpc() <> 'ok'
     or public.test_platform_capability_rpc() <> 'ok' then
    raise exception 'aal2 admin could not use platform authority';
  end if;
  if (select count(*) from public.ops_orders) <> 1
     or (select count(*) from public.kyc_documents) <> 1 then
    raise exception 'aal2 admin could not read protected rows';
  end if;
end
$$;

reset role;

-- Removing the factor closes authority immediately even while the signed JWT
-- still says aal2 (Supabase documents that this claim can remain stale until a
-- refresh). The database checks both facts.
delete from auth.mfa_factors
where id = 'f0000000-0000-0000-0000-000000000001';
set local role authenticated;
do $$
begin
  if public.auth_role() is not null then
    raise exception 'aal2 token retained admin authority after factor removal';
  end if;
  begin
    perform public.test_admin_rpc();
    raise exception 'aal2 token called admin RPC after factor removal';
  exception when check_violation then null;
  end;
  begin
    perform public.record_cash_handin(
      '50000000-0000-0000-0000-000000000001', 100, 'hand_in', null
    );
    raise exception 'stale aal2 token bypassed the admin/dispatcher NULL guard';
  exception when check_violation then null;
  end;
  begin
    perform public.restaurant_scorecard(
      '40000000-0000-0000-0000-000000000002', 30
    );
    raise exception 'stale aal2 token bypassed the admin/merchant NULL guard';
  exception when check_violation then null;
  end;
  begin
    perform public.test_platform_owner_rpc();
    raise exception 'aal2 token retained platform-owner authority after factor removal';
  exception when check_violation then null;
  end;
  begin
    perform public.test_platform_capability_rpc();
    raise exception 'aal2 token retained platform capability after factor removal';
  exception when check_violation then null;
  end;
end
$$;
reset role;

-- Machine/background checks about an operator are not user-session authority
-- and must remain available without a request JWT subject.
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
do $$
begin
  if not public.is_platform_owner('a0000000-0000-0000-0000-000000000001')
     or not public.has_platform_capability(
       'a0000000-0000-0000-0000-000000000001',
       'expansion_launch_manager'
     ) then
    raise exception 'background platform-authority inspection was narrowed';
  end if;
end
$$;

-- Dispatcher at aal1 keeps dispatch authority but does not gain admin/KYC.
select set_config(
  'request.jwt.claims',
  '{"sub":"d0000000-0000-0000-0000-000000000001","aal":"aal1"}',
  true
);
set local role authenticated;

do $$
begin
  if public.auth_role() is distinct from 'dispatcher'::public.app_role then
    raise exception 'dispatcher role was narrowed by the admin MFA gate';
  end if;
  if public.test_admin_dispatcher_rpc() <> 'ok' then
    raise exception 'dispatcher lost mixed RPC authority';
  end if;
  if public.record_cash_handin(
    '50000000-0000-0000-0000-000000000001', 100, 'hand_in', null
  ) <> 100 then
    raise exception 'dispatcher lost cash-reconciliation authority';
  end if;
  if (select count(*) from public.ops_orders) <> 1 then
    raise exception 'dispatcher lost ops read authority';
  end if;
  if (select count(*) from public.kyc_documents) <> 0 then
    raise exception 'dispatcher gained admin-only KYC authority';
  end if;
end
$$;

reset role;

-- Customer ownership and merchant staff access are unchanged at aal1.
select set_config(
  'request.jwt.claims',
  '{"sub":"c0000000-0000-0000-0000-000000000001","aal":"aal1"}',
  true
);
set local role authenticated;
do $$
begin
  if (select count(*) from public.kyc_documents) <> 1 then
    raise exception 'customer lost own-row access';
  end if;
end
$$;
reset role;

select set_config(
  'request.jwt.claims',
  '{"sub":"e0000000-0000-0000-0000-000000000001","aal":"aal1"}',
  true
);
set local role authenticated;
do $$
begin
  if (select count(*) from public.merchant_catalog) <> 1 then
    raise exception 'merchant staff lost own catalog access';
  end if;
  perform public.restaurant_scorecard(
    '40000000-0000-0000-0000-000000000001', 30
  );
end
$$;
reset role;

do $$ begin
  raise notice 'PASS admin MFA authority: aal1 admin denied; aal2 admin, dispatcher, customer and merchant paths preserved';
end $$;

rollback;
