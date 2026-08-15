\set ON_ERROR_STOP on

begin;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin; end if;
end;
$$;

create schema auth;
create schema private;
create type public.app_role as enum ('customer','driver','merchant_staff','dispatcher','admin');

create function auth.uid()
returns uuid language sql stable
as $$
  select (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')::uuid
$$;

create table public.users (
  id uuid primary key,
  role public.app_role not null
);
create table public.deletion_probe (
  user_id uuid primary key,
  calls integer not null default 0
);
grant select on public.deletion_probe to authenticated;

-- Sentinel for the live migration-207 implementation. The repair must preserve
-- it for customers and keep it unreachable to every non-customer role.
create function public.anonymize_my_account()
returns void language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  insert into public.deletion_probe(user_id, calls)
  values (auth.uid(), 1)
  on conflict (user_id) do update set calls = public.deletion_probe.calls + 1;
end;
$$;
revoke all on function public.anonymize_my_account() from public, anon;
grant execute on function public.anonymize_my_account() to authenticated;

insert into public.users(id, role) values
  ('10000000-0000-0000-0000-000000000001', 'customer'),
  ('10000000-0000-0000-0000-000000000002', 'driver'),
  ('10000000-0000-0000-0000-000000000003', 'merchant_staff'),
  ('10000000-0000-0000-0000-000000000004', 'dispatcher'),
  ('10000000-0000-0000-0000-000000000005', 'admin');

\ir ../migrations/20260815050843_restrict_customer_account_deletion.sql

create function pg_temp.assert_role_rejected(p_uid uuid)
returns void language plpgsql
as $$
begin
  perform set_config('request.jwt.claims', jsonb_build_object('sub', p_uid)::text, true);
  begin
    perform public.anonymize_my_account();
    raise exception 'non-customer account deletion was accepted';
  exception when check_violation then
    if sqlerrm <> 'ACCOUNT_DELETION_ROLE_NOT_SUPPORTED' then
      raise exception 'wrong rejection: %', sqlerrm;
    end if;
  end;
  if exists (select 1 from public.deletion_probe where user_id = p_uid) then
    raise exception 'non-customer implementation ran before the role guard';
  end if;
end;
$$;

set local role authenticated;
select pg_temp.assert_role_rejected('10000000-0000-0000-0000-000000000002');
select pg_temp.assert_role_rejected('10000000-0000-0000-0000-000000000003');
select pg_temp.assert_role_rejected('10000000-0000-0000-0000-000000000004');
select pg_temp.assert_role_rejected('10000000-0000-0000-0000-000000000005');

select set_config(
  'request.jwt.claims',
  '{"sub":"10000000-0000-0000-0000-000000000001"}',
  true
);
select public.anonymize_my_account();

reset role;

do $$
begin
  if (select calls from public.deletion_probe
      where user_id = '10000000-0000-0000-0000-000000000001') <> 1 then
    raise exception 'customer did not reach preserved anonymizer';
  end if;
  if (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'anonymize_my_account') <> 1 then
    raise exception 'public anonymize_my_account must have one overload';
  end if;
  if has_function_privilege('anon', 'public.anonymize_my_account()', 'EXECUTE') then
    raise exception 'anon database role can execute account deletion';
  end if;
  if has_function_privilege('authenticated', 'private.anonymize_customer_account_impl()', 'EXECUTE') then
    raise exception 'authenticated can bypass the customer-role wrapper';
  end if;
end;
$$;

rollback;
