\set ON_ERROR_STOP on

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

-- Shims: the enum value sets mirror the real definitions exactly
-- (supabase/migrations/002_app_schema.sql lines 37-38 for currency_type /
-- locale_type; 007_roles_merchant_staff.sql line 20 for app_role).
create type app_role as enum ('customer','driver','merchant_staff','dispatcher','admin');
create type locale_type as enum ('en','ar','ru','it','de');
create type currency_type as enum ('EGP','EUR','USD','GBP','RUB');

create schema auth;
create table auth.users (
  id uuid primary key,
  phone text,
  raw_user_meta_data jsonb
);

create table public.users (
  id                 uuid primary key references auth.users(id) on delete cascade,
  phone              text not null,
  display_name       text not null,
  locale             locale_type not null default 'ar',
  preferred_currency currency_type not null default 'EGP',
  role               app_role not null default 'customer',
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

-- NEGATIVE CONTROL: install the OLD 007 body verbatim first, proving the
-- exploit exists and that this test can actually detect it.
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
    coalesce((new.raw_user_meta_data->>'role')::app_role, 'customer')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_auth_user();

insert into auth.users (id, phone, raw_user_meta_data)
values (
  '00000000-0000-0000-0000-0000000000a1',
  '+201000000001',
  '{"role":"admin"}'::jsonb
);

do $$
declare
  v_role app_role;
begin
  select role into v_role from public.users where id = '00000000-0000-0000-0000-0000000000a1';
  if v_role is distinct from 'admin' then
    raise exception 'negative control failed: old body did not honor the role hint — test proves nothing';
  end if;
end;
$$;

-- Apply the real migration under test.
\ir ../migrations/124_signup_role_hint_lockdown.sql

-- A second signup carrying the exploit hint, plus a benign display_name hint,
-- must now land as role='customer' while display_name is still honored.
insert into auth.users (id, phone, raw_user_meta_data)
values (
  '00000000-0000-0000-0000-0000000000a2',
  '+201000000002',
  '{"role":"admin","display_name":"Mallory"}'::jsonb
);

do $$
declare
  v_role app_role;
  v_name text;
begin
  select role, display_name into v_role, v_name
    from public.users where id = '00000000-0000-0000-0000-0000000000a2';
  if v_role is distinct from 'customer' then
    raise exception 'role hint still honored after mig 124 — got role=%', v_role;
  end if;
  if v_name is distinct from 'Mallory' then
    raise exception 'benign display_name hint was not honored — got display_name=%', v_name;
  end if;
end;
$$;

-- The fixed body must no longer reference the role hint at all.
do $$
begin
  if pg_get_functiondef('public.handle_new_auth_user()'::regprocedure)
     like '%raw_user_meta_data->>''role''%' then
    raise exception 'handle_new_auth_user still references raw_user_meta_data role hint';
  end if;
end;
$$;

-- Idempotency: the migration must apply twice cleanly.
\ir ../migrations/124_signup_role_hint_lockdown.sql

rollback;

\echo '124_signup_role_hint_lockdown.test.sql: PASS'
