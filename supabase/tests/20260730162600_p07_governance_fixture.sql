-- Deterministic production-contract fixture for Package 07 governance CI.
--
-- This file is loaded only into the local Unix-socket PostgreSQL cluster
-- created by scripts/test-security-migrations.sh. It deliberately contains no
-- connection string and no Supabase project reference, so the harness cannot
-- target production.
--
-- The fixture is narrow but production-shaped: it reproduces the columns,
-- constraints, ACL roles, user FK, vertical authority, lifecycle writer, and
-- users-row -> vertical-lock grant order exercised by the hardening and dblink
-- concurrency suites. The migration under test then replaces the cuisine and
-- lifecycle producer contracts exactly as it would on the full schema.

\set ON_ERROR_STOP on

create extension if not exists pgcrypto;
create extension if not exists dblink;

do $roles$
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
$roles$;

create schema if not exists auth;
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table auth.users (
  id uuid primary key,
  instance_id uuid,
  aud text,
  role text,
  email text,
  encrypted_password text,
  email_confirmed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function auth.uid()
returns uuid
language sql
stable
set search_path = pg_catalog
as $function$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), '')::uuid,
    nullif(
      (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'),
      ''
    )::uuid
  );
$function$;

create type public.app_role as enum (
  'customer', 'driver', 'merchant_staff', 'dispatcher', 'admin'
);
create type public.cuisine_type as enum (
  'italian', 'seafood', 'egyptian', 'sushi', 'healthy', 'burgers', 'cafe',
  'asian', 'pizza', 'breakfast', 'late_night', 'street_food', 'sweets',
  'grocery', 'pharmacy'
);
create type public.zone_type as enum (
  'naama', 'hadaba', 'nabq', 'old_market', 'soho', 'sharks_bay',
  'el_salam', 'mubarak_7', 'el_rowaisat', 'hay_el_nour',
  'el_hadaba_residential'
);

create table public.users (
  id uuid primary key references auth.users(id) on delete cascade,
  role public.app_role not null default 'customer',
  phone text not null default '',
  display_name text not null default '',
  is_blocked boolean not null default false,
  updated_at timestamptz not null default now()
);

create table public.zones (
  id public.zone_type primary key,
  is_active boolean not null default true
);

create table public.verticals (
  id text primary key,
  is_active boolean not null default true,
  launch_stage text not null default 'disabled'
    check (launch_stage in ('disabled', 'private', 'public'))
);

create table public.restaurants (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  description text not null default '',
  cuisines public.cuisine_type[] not null default '{}',
  cuisine_label text not null default '',
  cover_image text not null default '',
  logo text,
  zone public.zone_type not null references public.zones(id),
  vertical_id text not null default 'food' references public.verticals(id),
  prep_time_low integer not null default 10,
  prep_time_high integer not null default 30,
  delivery_fee_egp integer not null default 25,
  min_order_egp integer not null default 0,
  tourist_safe boolean not null default false,
  is_open boolean not null default true,
  is_open_24h boolean not null default false,
  featured boolean not null default false,
  promo text,
  is_active boolean not null default true,
  merchant_type text not null default 'third_party',
  phone text,
  address text,
  payout_method text,
  payout_bank_name text,
  payout_iban text,
  payout_wallet text,
  payout_holder text,
  onboarding_status text,
  commission_pct numeric,
  terms_version text,
  terms_accepted_at timestamptz
);

create table public.merchant_staff (
  profile_id uuid not null references public.users(id) on delete cascade,
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  staff_role text not null default 'staff',
  primary key (profile_id, restaurant_id)
);

create table public.customer_carts (
  user_id uuid primary key references public.users(id) on delete cascade,
  restaurant_id uuid references public.restaurants(id) on delete set null,
  items jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '30 days'
);

create table public.orders (
  id uuid primary key,
  short_code text not null,
  user_id uuid references public.users(id) on delete set null,
  restaurant_id uuid not null references public.restaurants(id),
  restaurant_name text not null,
  address_snapshot jsonb not null,
  items jsonb not null,
  subtotal_egp integer not null,
  delivery_fee_egp integer not null,
  tax_egp integer not null,
  total_egp integer not null,
  eta_at timestamptz not null,
  status text not null,
  payment_method text not null,
  payment_method_kind text not null,
  payment_label text not null,
  delivered_at timestamptz,
  vertical_id text not null references public.verticals(id)
);

create table public.platform_settings (
  key text primary key,
  value jsonb not null
);

create table public.vertical_private_access (
  id uuid primary key default gen_random_uuid(),
  vertical_id text not null references public.verticals(id) on delete cascade,
  user_id uuid references public.users(id) on delete set null,
  generation integer not null default 1,
  status text not null default 'active'
    check (status in ('active', 'revoked', 'expired')),
  cohort text,
  reason text,
  granted_at timestamptz not null default now(),
  expires_at timestamptz,
  granted_by uuid references public.users(id) on delete set null,
  revoked_at timestamptz,
  revoked_by uuid references public.users(id) on delete set null
);

create unique index vertical_private_access_one_active_uidx
  on public.vertical_private_access (vertical_id, user_id)
  where status = 'active' and user_id is not null;

create table public.vertical_launch_events (
  id uuid primary key default gen_random_uuid(),
  vertical_id text not null references public.verticals(id) on delete cascade,
  previous_stage text,
  new_stage text not null,
  previous_is_active boolean,
  new_is_active boolean not null,
  reason text not null,
  evidence_reference text,
  actor_user_id uuid references public.users(id) on delete set null,
  occurred_at timestamptz not null default now()
);

create table public.lifecycle_sends (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  lifecycle_event text not null,
  subject_id uuid,
  would_send boolean not null,
  suppression_reason text,
  holdout_group text not null check (holdout_group in ('treatment', 'control')),
  mode text not null check (mode in ('observe', 'live')),
  message_id uuid,
  decided_at timestamptz not null default now(),
  constraint lifecycle_sends_suppression_reason_check
    check (
      suppression_reason is null
      or suppression_reason in (
        'no_consent', 'quiet_hours', 'global_cap', 'event_cap', 'active_order',
        'subject_invalid', 'already_sent', 'holdout', 'no_recipient'
      )
    )
);

create or replace function public.auth_role()
returns public.app_role
language sql
stable
security definer
set search_path = public, pg_temp
as $function$
  select role from public.users where id = auth.uid();
$function$;

create or replace function public.is_within_service_area(
  p_lat double precision,
  p_lng double precision
)
returns boolean
language sql
stable
as $function$
  select p_lat is not null and p_lng is not null;
$function$;

create or replace function public.ops_alert(p_text text)
returns void
language plpgsql
as $function$
begin
  null;
end;
$function$;

create or replace function public.user_can_view_vertical(
  p_user_id uuid,
  p_vertical_id text
)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $function$
  select case
    when not coalesce(
      (select is_active from public.verticals where id = p_vertical_id),
      false
    ) then false
    when (
      select launch_stage from public.verticals where id = p_vertical_id
    ) = 'public' then true
    when (
      select launch_stage from public.verticals where id = p_vertical_id
    ) = 'private' then exists (
      select 1
        from public.vertical_private_access access
       where access.vertical_id = p_vertical_id
         and access.user_id = p_user_id
         and access.status = 'active'
         and (access.expires_at is null or access.expires_at > now())
    )
    else false
  end;
$function$;

create or replace function public.lifecycle_holdout_group(
  p_user_id uuid,
  p_event text
)
returns text
language sql
stable
as $function$
  select 'treatment'::text;
$function$;

create or replace function public.lifecycle_eligible(
  p_user_id uuid,
  p_event text,
  p_subject_id uuid default null
)
returns table (allowed boolean, reason text, holdout_group text)
language sql
stable
security definer
set search_path = public, pg_temp
as $function$
  select true, null::text, public.lifecycle_holdout_group(p_user_id, p_event);
$function$;

create or replace function public.lifecycle_record(
  p_user_id uuid,
  p_event text,
  p_subject_id uuid,
  p_would_send boolean,
  p_reason text,
  p_group text,
  p_message_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
begin
  insert into public.lifecycle_sends (
    user_id,
    lifecycle_event,
    subject_id,
    would_send,
    suppression_reason,
    holdout_group,
    mode,
    message_id
  ) values (
    p_user_id,
    p_event,
    p_subject_id,
    coalesce(p_would_send, false),
    p_reason,
    coalesce(nullif(p_group, ''), 'treatment'),
    'observe',
    p_message_id
  );
exception when others then
  raise warning 'lifecycle_record(%, %) failed: %', p_event, p_user_id, sqlerrm;
end;
$function$;

create or replace function public.lifecycle_is_live()
returns boolean
language sql
stable
security definer
as $function$
  select false;
$function$;

create or replace function public.enqueue_push(
  p_event text,
  p_order_id uuid default null,
  p_recipient_user_ids uuid[] default null,
  p_idempotency_key text default null,
  p_route text default null,
  p_vertical text default null,
  p_category text default 'operational',
  p_custom_title text default null,
  p_custom_body text default null,
  p_campaign_id uuid default null,
  p_expires_in interval default null
)
returns uuid
language sql
as $function$
  select null::uuid;
$function$;

-- Relevant production lock order from migration 160: target users row first,
-- then the exclusive vertical transition lock.
create or replace function public.grant_vertical_private_access(
  p_vertical_id text,
  p_user_id uuid,
  p_cohort text,
  p_reason text,
  p_expires_at timestamptz default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_actor uuid := auth.uid();
  v_id uuid;
  v_generation integer;
begin
  if v_actor is null then
    raise exception 'AUTH_REQUIRED' using errcode = 'check_violation';
  end if;

  perform 1 from public.users where id = p_user_id for update;
  if not found then
    raise exception 'USER_NOT_FOUND' using errcode = 'check_violation';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('vertical:' || p_vertical_id, 0)
  );

  update public.vertical_private_access
     set status = 'revoked',
         revoked_at = now(),
         revoked_by = v_actor
   where vertical_id = p_vertical_id
     and user_id = p_user_id
     and status = 'active';

  select coalesce(max(generation), 0) + 1
    into v_generation
    from public.vertical_private_access
   where vertical_id = p_vertical_id and user_id = p_user_id;

  insert into public.vertical_private_access (
    vertical_id,
    user_id,
    generation,
    status,
    cohort,
    reason,
    expires_at,
    granted_by
  ) values (
    p_vertical_id,
    p_user_id,
    v_generation,
    'active',
    p_cohort,
    p_reason,
    p_expires_at,
    v_actor
  )
  returning id into v_id;

  return v_id;
end;
$function$;

-- Broad cuisine overloads are the pre-hardening production contract. The
-- migration must remove them and leave exactly one food-only overload each.
create or replace function public.admin_update_restaurant(
  p_id uuid,
  p_name text,
  p_description text,
  p_cuisines public.cuisine_type[],
  p_cuisine_label text,
  p_cover_image text,
  p_logo text,
  p_zone public.zone_type,
  p_prep_time_low integer,
  p_prep_time_high integer,
  p_delivery_fee_egp integer,
  p_min_order_egp integer,
  p_tourist_safe boolean,
  p_is_open boolean,
  p_is_open_24h boolean,
  p_featured boolean,
  p_promo text,
  p_is_active boolean
)
returns void
language plpgsql
security definer
as $function$
begin
  null;
end;
$function$;

create or replace function public.apply_as_restaurant(
  p_name text,
  p_description text,
  p_cuisines public.cuisine_type[],
  p_phone text,
  p_address text,
  p_zone public.zone_type,
  p_lat double precision,
  p_lng double precision,
  p_is_open_24h boolean,
  p_prep_low integer,
  p_prep_high integer,
  p_payout_method text,
  p_payout_bank_name text,
  p_payout_iban text,
  p_payout_wallet text,
  p_payout_holder text,
  p_terms_version text
)
returns uuid
language sql
security definer
as $function$
  select null::uuid;
$function$;

revoke all on function public.user_can_view_vertical(uuid, text)
  from public, anon, authenticated;
revoke all on function public.lifecycle_eligible(uuid, text, uuid)
  from public, anon, authenticated;
revoke all on function public.lifecycle_record(
  uuid, text, uuid, boolean, text, text, uuid
) from public, anon, authenticated;
revoke all on function public.lifecycle_is_live()
  from public, anon, authenticated;

grant usage on schema public, auth to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;

insert into public.zones (id) values ('naama');
insert into public.verticals (id, is_active, launch_stage) values
  ('food', true, 'public'),
  ('grocery', true, 'public'),
  ('pharmacy', true, 'public');

insert into auth.users (
  id,
  instance_id,
  aud,
  role,
  email,
  encrypted_password
) values (
  '91967dc5-9b0c-4ce4-ad8b-9810b3aee768',
  '00000000-0000-0000-0000-000000000000',
  'authenticated',
  'authenticated',
  '_tp07_operator@example.test',
  ''
);

insert into public.users (
  id,
  role,
  phone,
  display_name,
  is_blocked
) values (
  '91967dc5-9b0c-4ce4-ad8b-9810b3aee768',
  'admin',
  '+201000000700',
  'P07 fixture operator',
  false
);
