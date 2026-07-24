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

create schema auth;
create function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;

create schema extensions;
create extension pgcrypto with schema extensions;

create schema storage;
create table storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text not null,
  name text not null
);
alter table storage.objects enable row level security;
create policy "kyc_update_own"
  on storage.objects for update to authenticated
  using (bucket_id = 'kyc')
  with check (bucket_id = 'kyc');

create table public.push_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  token text not null,
  platform text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create type public.kyc_subject_type as enum ('driver', 'restaurant');
create type public.kyc_doc_status as enum ('pending', 'approved', 'rejected');

create table public.kyc_documents (
  id uuid primary key default gen_random_uuid(),
  subject_type public.kyc_subject_type not null,
  subject_id uuid not null,
  doc_type text not null,
  storage_path text not null,
  status public.kyc_doc_status not null default 'pending',
  review_note text,
  reviewed_by uuid,
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.drivers (
  id uuid primary key,
  is_verified boolean not null default false
);

create function public.auth_role()
returns text
language sql
stable
as $$
  select nullif(current_setting('request.jwt.claim.role_name', true), '')
$$;

create table public.customer_credit_balance (
  user_id uuid primary key,
  balance_egp int not null,
  updated_at timestamptz not null default now()
);

create table public.promo_codes (
  code text primary key,
  kind text not null,
  value int not null,
  per_user_limit int,
  is_active boolean not null,
  owner_user_id uuid,
  max_uses int
);

create table public.credit_ledger (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  delta_egp int not null,
  reason text not null,
  note text
);

create table public.customer_loyalty (
  user_id uuid primary key,
  points_balance int not null,
  updated_at timestamptz not null default now()
);

create table public.platform_settings (
  key text primary key,
  value jsonb not null
);

create table public.loyalty_points_ledger (
  id uuid primary key default gen_random_uuid(),
  subject_type text not null,
  subject_id uuid not null,
  delta_points int not null,
  reason text not null
);

insert into public.push_tokens (
  id, user_id, token, platform, created_at, updated_at
)
values
  (
    '60000000-0000-0000-0000-000000000001',
    '61000000-0000-0000-0000-000000000001',
    'ExponentPushToken[duplicate-device-token]',
    'ios',
    now() - interval '2 days',
    now() - interval '2 days'
  ),
  (
    '60000000-0000-0000-0000-000000000002',
    '61000000-0000-0000-0000-000000000002',
    'ExponentPushToken[duplicate-device-token]',
    'ios',
    now() - interval '1 day',
    now() - interval '1 day'
  );

\ir ../migrations/120_runtime_and_kyc_integrity_fixes.sql

do $$
begin
  if (
    select count(*)
      from public.push_tokens
     where token = 'ExponentPushToken[duplicate-device-token]'
  ) <> 1 then
    raise exception 'legacy duplicate push token was not removed';
  end if;

  if not exists (
    select 1
      from public.push_tokens
     where token = 'ExponentPushToken[duplicate-device-token]'
       and user_id = '61000000-0000-0000-0000-000000000002'
  ) then
    raise exception 'push token deduplication did not keep the newest row';
  end if;

  if exists (
    select 1
      from pg_policies
     where schemaname = 'storage'
       and tablename = 'objects'
       and policyname = 'kyc_update_own'
  ) then
    raise exception 'KYC update policy was not removed';
  end if;

  if has_function_privilege(
    'anon',
    'public.register_push_token(text,text)',
    'EXECUTE'
  ) then
    raise exception 'anonymous role can register push tokens';
  end if;
  if not has_function_privilege(
    'authenticated',
    'public.register_push_token(text,text)',
    'EXECUTE'
  ) then
    raise exception 'authenticated role cannot register push tokens';
  end if;
end;
$$;

select set_config(
  'request.jwt.claim.sub',
  '61000000-0000-0000-0000-000000000003',
  true
);

select public.register_push_token(
  'ExponentPushToken[duplicate-device-token]',
  'ANDROID'
);

do $$
begin
  if not exists (
    select 1
      from public.push_tokens
     where token = 'ExponentPushToken[duplicate-device-token]'
       and user_id = '61000000-0000-0000-0000-000000000003'
       and platform = 'android'
  ) then
    raise exception 'push token ownership was not transferred';
  end if;
end;
$$;

insert into public.drivers (id, is_verified)
values (
  '62000000-0000-0000-0000-000000000001',
  true
);

insert into public.kyc_documents (
  id, subject_type, subject_id, doc_type, storage_path
)
values
  (
    '63000000-0000-0000-0000-000000000001',
    'driver',
    '62000000-0000-0000-0000-000000000001',
    'national_id',
    'driver/national-id.jpg'
  ),
  (
    '63000000-0000-0000-0000-000000000002',
    'restaurant',
    '62000000-0000-0000-0000-000000000002',
    'commercial_reg',
    'restaurant/commercial-reg.jpg'
  );

select set_config('request.jwt.claim.role_name', 'admin', true);

select public.review_kyc_document(
  '63000000-0000-0000-0000-000000000001',
  false,
  'expired'
);
select public.review_kyc_document(
  '63000000-0000-0000-0000-000000000002',
  false,
  'expired'
);

do $$
begin
  if exists (
    select 1
      from public.drivers
     where id = '62000000-0000-0000-0000-000000000001'
       and is_verified
  ) then
    raise exception 'driver rejection did not clear verification';
  end if;
  if (
    select count(*)
      from public.kyc_documents
     where status = 'rejected'
  ) <> 2 then
    raise exception 'driver/restaurant KYC rejection did not complete';
  end if;
end;
$$;

insert into public.customer_credit_balance (user_id, balance_egp)
values ('61000000-0000-0000-0000-000000000003', 100);

insert into public.customer_loyalty (user_id, points_balance)
values ('61000000-0000-0000-0000-000000000003', 1000);

insert into public.platform_settings (key, value)
values ('loyalty_points_per_egp', '10'::jsonb);

do $$
declare
  credit_code text;
  loyalty_code text;
begin
  credit_code := public.redeem_credit(40);
  if credit_code !~ '^CR-[0-9A-F]{32}$' then
    raise exception 'credit redemption generated an invalid code';
  end if;

  loyalty_code := public.redeem_points(500);
  if loyalty_code !~ '^LOY-[0-9A-F]{32}$' then
    raise exception 'loyalty redemption generated an invalid code';
  end if;

  if (
    select balance_egp
      from public.customer_credit_balance
     where user_id = '61000000-0000-0000-0000-000000000003'
  ) <> 60 then
    raise exception 'credit balance was not debited';
  end if;

  if (
    select points_balance
      from public.customer_loyalty
     where user_id = '61000000-0000-0000-0000-000000000003'
  ) <> 500 then
    raise exception 'loyalty balance was not debited';
  end if;

  if not exists (
    select 1
      from public.promo_codes
     where code = credit_code
       and owner_user_id = '61000000-0000-0000-0000-000000000003'
       and value = 40
       and per_user_limit = 1
  ) then
    raise exception 'credit promo is not owner-bound and single-use';
  end if;

  if not exists (
    select 1
      from public.promo_codes
     where code = loyalty_code
       and owner_user_id = '61000000-0000-0000-0000-000000000003'
       and value = 50
       and per_user_limit = 1
       and max_uses = 1
  ) then
    raise exception 'loyalty promo is not owner-bound and single-use';
  end if;
end;
$$;

rollback;

\echo '120_runtime_and_kyc_integrity_fixes.test.sql: PASS'
