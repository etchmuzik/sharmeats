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

-- pgcrypto lives in the extensions schema, exactly like Supabase production:
-- unqualified gen_random_bytes must NOT resolve under search_path=public,pg_temp.
create schema extensions;
create extension pgcrypto with schema extensions;

create schema auth;
create function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;

create function public.auth_role()
returns text
language sql
stable
as $$
  select nullif(current_setting('request.jwt.claim.role_name', true), '')
$$;

-- Tables referenced by the carried-forward 120 repair bodies (the plpgsql
-- validator resolves row-type declarations at CREATE time).
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
  reviewed_at timestamptz
);
create table public.drivers (
  id uuid primary key,
  is_verified boolean not null default false
);
create table public.customer_credit_balance (
  user_id uuid primary key,
  balance_egp int not null default 0,
  updated_at timestamptz not null default now()
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
  points_balance int not null default 0,
  updated_at timestamptz not null default now()
);
create table public.loyalty_points_ledger (
  id uuid primary key default gen_random_uuid(),
  subject_type text not null,
  subject_id uuid not null,
  delta_points int not null,
  reason text not null
);

-- Minimal tables the trigger touches.
create table public.orders (
  id uuid primary key default gen_random_uuid(),
  status text not null default 'placed'
);

create table public.referrals (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id),
  referrer_id uuid not null,
  reward_status text not null default 'pending',
  reward_code text,
  rewarded_at timestamptz
);

create table public.platform_settings (
  key text primary key,
  value jsonb not null
);

create table public.promo_codes (
  code text primary key,
  kind text not null,
  value int not null,
  per_user_limit int,
  is_active boolean not null default true,
  owner_user_id uuid
);

-- The migration also re-pins this function's search_path; give it something to pin.
create function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$ begin return new; end; $$;

-- NEGATIVE CONTROL: the 081 body (unqualified call) must silently fail to
-- reward under this prod-faithful schema layout — proving the test would catch
-- a regression to the old body.
create or replace function public.reward_referrer_on_delivery()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_ref public.referrals; v_reward int; v_code text;
begin
  if new.status <> 'delivered' or old.status = 'delivered' then return new; end if;
  select * into v_ref from public.referrals where order_id = new.id and reward_status = 'pending' for update;
  if not found then return new; end if;
  select coalesce((value #>> '{}')::int, 50) into v_reward from public.platform_settings where key = 'referral_referrer_reward_egp';
  v_code := 'REF-' || upper(encode(gen_random_bytes(16), 'hex'));
  insert into public.promo_codes (code, kind, value, per_user_limit, is_active, owner_user_id)
  values (upper(v_code), 'fixed', greatest(1, coalesce(v_reward,50)), 1, true, v_ref.referrer_id);
  update public.referrals set reward_status = 'rewarded', reward_code = upper(v_code), rewarded_at = now() where id = v_ref.id;
  return new;
exception when others then return new;
end;
$function$;

create trigger orders_reward_referrer
  after update of status on public.orders
  for each row execute function public.reward_referrer_on_delivery();

insert into public.orders (id, status)
values ('00000000-0000-0000-0000-00000000c0de', 'out_for_delivery');
insert into public.referrals (order_id, referrer_id)
values ('00000000-0000-0000-0000-00000000c0de', '00000000-0000-0000-0000-0000000000aa');

update public.orders set status = 'delivered'
 where id = '00000000-0000-0000-0000-00000000c0de';

do $$
begin
  if exists (
    select 1 from public.referrals
     where order_id = '00000000-0000-0000-0000-00000000c0de'
       and reward_status = 'rewarded'
  ) then
    raise exception 'negative control failed: unqualified 081 body unexpectedly minted a reward — pgcrypto is leaking into public and this test proves nothing';
  end if;
end;
$$;

-- Apply the real migration under test.
\ir ../migrations/122_referral_reward_crypto_fix.sql

-- The fixed bodies must be installed and schema-qualified (the three
-- carried-forward 120 repairs are behaviorally covered by 120's own test;
-- here we assert the hotfix installs the repaired definitions).
do $$
begin
  if pg_get_functiondef('public.reward_referrer_on_delivery()'::regprocedure)
     not like '%extensions.gen_random_bytes%' then
    raise exception 'reward_referrer_on_delivery does not use extensions.gen_random_bytes';
  end if;
  if pg_get_functiondef('public.redeem_credit(int)'::regprocedure)
     not like '%extensions.gen_random_bytes%' then
    raise exception 'redeem_credit carry-forward does not use extensions.gen_random_bytes';
  end if;
  if pg_get_functiondef('public.redeem_points(int)'::regprocedure)
     not like '%extensions.gen_random_bytes%' then
    raise exception 'redeem_points carry-forward does not use extensions.gen_random_bytes';
  end if;
  if pg_get_functiondef('public.review_kyc_document(uuid, boolean, text)'::regprocedure)
     like '%restaurants%' then
    raise exception 'review_kyc_document carry-forward still references restaurants';
  end if;
  if pg_get_functiondef('public.handle_new_auth_user()'::regprocedure)
     not like '%pg_temp%' then
    raise exception 'handle_new_auth_user search_path was not re-pinned with pg_temp';
  end if;
end;
$$;

-- FUNCTIONAL: a fresh pending referral now mints a REF- promo bound to the
-- referrer and flips to rewarded, on the delivery transition.
insert into public.orders (id, status)
values ('00000000-0000-0000-0000-00000000f00d', 'out_for_delivery');
insert into public.referrals (order_id, referrer_id)
values ('00000000-0000-0000-0000-00000000f00d', '00000000-0000-0000-0000-0000000000bb');

update public.orders set status = 'delivered'
 where id = '00000000-0000-0000-0000-00000000f00d';

do $$
declare
  v_ref public.referrals;
begin
  select * into v_ref from public.referrals
   where order_id = '00000000-0000-0000-0000-00000000f00d';
  if v_ref.reward_status <> 'rewarded' then
    raise exception 'referral not rewarded after delivery (status=%)', v_ref.reward_status;
  end if;
  if v_ref.reward_code !~ '^REF-[0-9A-F]{32}$' then
    raise exception 'unexpected reward code format: %', v_ref.reward_code;
  end if;
  if not exists (
    select 1 from public.promo_codes
     where code = v_ref.reward_code
       and owner_user_id = '00000000-0000-0000-0000-0000000000bb'
       and per_user_limit = 1 and is_active
  ) then
    raise exception 'reward promo code missing or not bound to referrer';
  end if;
end;
$$;

-- Idempotency: the migration must apply twice cleanly.
\ir ../migrations/122_referral_reward_crypto_fix.sql

rollback;

\echo '122_referral_reward_crypto_fix.test.sql: PASS'
