\set ON_ERROR_STOP on

-- A clean project must not depend on Supabase's historical implicit Data API
-- grants. Start from the old broad ACL posture, apply the migration, and prove
-- both the current relation ACLs and the default ACLs for future objects.
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
  if not exists (select 1 from pg_roles where rolname = 'postgres') then
    create role postgres nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'supabase_admin') then
    create role supabase_admin nologin;
  end if;
end;
$$;

-- Match hosted Supabase: application relations are owned by the non-superuser
-- migration role, while supabase_admin is a separate role it cannot SET ROLE
-- to or alter defaults for.
grant create on schema public to postgres, supabase_admin;
alter schema public owner to postgres;
set role postgres;

-- Authority-bearing tables need realistic column names so column ACLs can be
-- checked independently of table-level privileges.
create table public.users (
  id uuid,
  phone text,
  display_name text,
  email text,
  default_address_id uuid,
  default_payment_method_id uuid,
  preferred_currency text,
  locale text,
  allergy_profile jsonb,
  terms_accepted_version text,
  terms_accepted_at timestamptz,
  role text,
  referral_code text
);
create table public.addresses (id uuid, is_default boolean, label text);
create table public.payment_methods (id uuid, is_default boolean, label text);
create table public.restaurants (
  id uuid,
  is_open boolean,
  payout_method text,
  payout_bank_name text,
  payout_iban text,
  payout_wallet text,
  payout_holder text,
  logo text,
  commission_pct numeric
);
create table public.drivers (
  id uuid,
  status text,
  payout_method text,
  payout_bank_name text,
  payout_iban text,
  payout_wallet text,
  payout_holder text,
  photo text,
  is_verified boolean
);
create table public.orders (
  id uuid,
  rating_food integer,
  rating_delivery integer,
  rating_comment text,
  status text,
  total_egp integer
);
create table public.order_messages (id uuid, read_at timestamptz, body text);
create table public.support_messages (id uuid, read_at timestamptz, body text);
create table public.order_refunds (
  id uuid,
  order_id uuid,
  amount_egp integer,
  reason text,
  status text,
  created_at timestamptz,
  updated_at timestamptz,
  provider_detail jsonb,
  actor_id uuid
);

-- Called-RPC stubs that historically granted a named role without first
-- revoking PostgreSQL's default PUBLIC EXECUTE.
create domain public.geography as text;
create function public.get_restaurant_reviews(uuid, integer)
returns integer language sql as 'select 1';
create function public.quote_delivery_fee(uuid, public.geography, integer)
returns integer language sql as 'select 1';
create function public.my_loyalty_status()
returns integer language sql as 'select 1';
create function public.my_loyalty_history(integer)
returns integer language sql as 'select 1';
create function public.my_driver_tier()
returns integer language sql as 'select 1';
create function public.my_restaurant_tier()
returns integer language sql as 'select 1';
create function public.my_referral_code()
returns integer language sql as 'select 1';

do $fixtures$
declare
  relation_name text;
begin
  foreach relation_name in array array[
    'hotels', 'zones', 'menu_sections', 'menu_items', 'modifiers',
    'modifier_options', 'order_assignments', 'driver_earnings',
    'merchant_staff', 'kyc_documents', 'push_tokens', 'favorites',
    'favorite_items', 'saved_orders', 'saved_orders_visible',
    'customer_carts', 'restaurant_settlements', 'driver_settlements',
    'driver_cash_balance', 'order_shares', 'platform_settings',
    'public_drivers', 'notification_prefs', 'push_messages',
    'push_attempts', 'order_status_events', 'payment_attempts'
  ]
  loop
    execute format('create table public.%I (id uuid)', relation_name);
  end loop;
end;
$fixtures$;

-- Reproduce the legacy project posture: existing relations and objects created
-- later by either Supabase migration grantor inherit broad Data API privileges.
grant all privileges on all tables in schema public
  to public, anon, authenticated, service_role;

alter default privileges for role postgres in schema public
  grant all privileges on tables to public, anon, authenticated, service_role;
alter default privileges for role postgres in schema public
  grant all privileges on sequences to public, anon, authenticated, service_role;
alter default privileges for role postgres in schema public
  grant execute on functions to public, anon, authenticated, service_role;

reset role;
set role supabase_admin;
alter default privileges for role supabase_admin in schema public
  grant all privileges on tables to public, anon, authenticated, service_role;
alter default privileges for role supabase_admin in schema public
  grant all privileges on sequences to public, anon, authenticated, service_role;
alter default privileges for role supabase_admin in schema public
  grant execute on functions to public, anon, authenticated, service_role;
reset role;

set role postgres;
\ir ../migrations/20260815044240_explicit_data_api_grants.sql
reset role;

create function pg_temp.assert_table_privilege(
  role_name text,
  relation_name text,
  privilege_name text,
  expected boolean
)
returns void
language plpgsql
as $assertion$
declare
  actual boolean;
begin
  actual := has_table_privilege(
    role_name,
    format('public.%I', relation_name),
    privilege_name
  );
  if actual is distinct from expected then
    raise exception '%.% privilege %: expected %, got %',
      role_name, relation_name, privilege_name, expected, actual;
  end if;
end;
$assertion$;

create function pg_temp.assert_column_privilege(
  role_name text,
  relation_name text,
  column_name text,
  privilege_name text,
  expected boolean
)
returns void
language plpgsql
as $assertion$
declare
  actual boolean;
begin
  actual := has_column_privilege(
    role_name,
    format('public.%I', relation_name),
    column_name,
    privilege_name
  );
  if actual is distinct from expected then
    raise exception '%.%.% privilege %: expected %, got %',
      role_name, relation_name, column_name, privilege_name, expected, actual;
  end if;
end;
$assertion$;

-- Public catalog: browseable, never writable through the anon key.
do $assertions$
declare relation_name text;
begin
  foreach relation_name in array array[
    'hotels', 'zones', 'restaurants', 'menu_sections', 'menu_items',
    'modifiers', 'modifier_options'
  ]
  loop
    perform pg_temp.assert_table_privilege('anon', relation_name, 'SELECT', true);
    perform pg_temp.assert_table_privilege('anon', relation_name, 'INSERT', false);
    perform pg_temp.assert_table_privilege('anon', relation_name, 'UPDATE', false);
    perform pg_temp.assert_table_privilege('anon', relation_name, 'DELETE', false);
    perform pg_temp.assert_table_privilege('anon', relation_name, 'TRUNCATE', false);
  end loop;
end;
$assertions$;

-- Authenticated read surface used by browser/mobile clients and Realtime.
do $assertions$
declare relation_name text;
begin
  foreach relation_name in array array[
    'users', 'addresses', 'payment_methods', 'hotels', 'zones',
    'restaurants', 'menu_sections', 'menu_items', 'modifiers',
    'modifier_options', 'orders', 'drivers', 'order_assignments',
    'driver_earnings', 'merchant_staff', 'kyc_documents', 'push_tokens',
    'favorites', 'favorite_items', 'saved_orders', 'saved_orders_visible',
    'customer_carts', 'order_messages', 'support_messages',
    'restaurant_settlements', 'driver_settlements', 'driver_cash_balance',
    'order_shares', 'platform_settings', 'public_drivers',
    'notification_prefs'
  ]
  loop
    perform pg_temp.assert_table_privilege(
      'authenticated', relation_name, 'SELECT', true
    );
    perform pg_temp.assert_table_privilege(
      'authenticated', relation_name, 'TRUNCATE', false
    );
  end loop;
end;
$assertions$;

-- Narrow client writes. RLS still decides which rows; these ACLs decide which
-- verbs and, for authority-bearing tables, which columns are even possible.
select pg_temp.assert_table_privilege('authenticated', 'addresses', 'INSERT', true);
select pg_temp.assert_table_privilege('authenticated', 'addresses', 'DELETE', true);
select pg_temp.assert_table_privilege('authenticated', 'addresses', 'UPDATE', false);
select pg_temp.assert_column_privilege('authenticated', 'addresses', 'is_default', 'UPDATE', true);
select pg_temp.assert_column_privilege('authenticated', 'addresses', 'label', 'UPDATE', false);

select pg_temp.assert_table_privilege('authenticated', 'payment_methods', 'INSERT', false);
select pg_temp.assert_table_privilege('authenticated', 'payment_methods', 'DELETE', false);
select pg_temp.assert_table_privilege('authenticated', 'payment_methods', 'UPDATE', false);
select pg_temp.assert_column_privilege('authenticated', 'payment_methods', 'is_default', 'UPDATE', true);
select pg_temp.assert_column_privilege('authenticated', 'payment_methods', 'label', 'UPDATE', false);

select pg_temp.assert_table_privilege('authenticated', 'restaurants', 'INSERT', true);
select pg_temp.assert_table_privilege('authenticated', 'restaurants', 'UPDATE', false);
select pg_temp.assert_table_privilege('authenticated', 'restaurants', 'DELETE', false);
select pg_temp.assert_column_privilege('authenticated', 'restaurants', 'is_open', 'UPDATE', true);
select pg_temp.assert_column_privilege('authenticated', 'restaurants', 'payout_iban', 'UPDATE', true);
select pg_temp.assert_column_privilege('authenticated', 'restaurants', 'logo', 'UPDATE', true);
select pg_temp.assert_column_privilege('authenticated', 'restaurants', 'commission_pct', 'UPDATE', false);

select pg_temp.assert_table_privilege('authenticated', 'drivers', 'UPDATE', false);
select pg_temp.assert_column_privilege('authenticated', 'drivers', 'status', 'UPDATE', true);
select pg_temp.assert_column_privilege('authenticated', 'drivers', 'payout_iban', 'UPDATE', true);
select pg_temp.assert_column_privilege('authenticated', 'drivers', 'photo', 'UPDATE', true);
select pg_temp.assert_column_privilege('authenticated', 'drivers', 'is_verified', 'UPDATE', false);

select pg_temp.assert_table_privilege('authenticated', 'users', 'INSERT', false);
select pg_temp.assert_table_privilege('authenticated', 'users', 'UPDATE', false);
select pg_temp.assert_column_privilege('authenticated', 'users', 'display_name', 'UPDATE', true);
select pg_temp.assert_column_privilege('authenticated', 'users', 'allergy_profile', 'UPDATE', true);
select pg_temp.assert_column_privilege('authenticated', 'users', 'terms_accepted_at', 'UPDATE', true);
select pg_temp.assert_column_privilege('authenticated', 'users', 'role', 'UPDATE', false);
select pg_temp.assert_column_privilege('authenticated', 'users', 'referral_code', 'UPDATE', false);

select pg_temp.assert_table_privilege('authenticated', 'orders', 'INSERT', false);
select pg_temp.assert_table_privilege('authenticated', 'orders', 'UPDATE', false);
select pg_temp.assert_column_privilege('authenticated', 'orders', 'rating_food', 'UPDATE', true);
select pg_temp.assert_column_privilege('authenticated', 'orders', 'rating_comment', 'UPDATE', true);
select pg_temp.assert_column_privilege('authenticated', 'orders', 'status', 'UPDATE', false);

do $assertions$
declare relation_name text;
begin
  foreach relation_name in array array['menu_sections', 'menu_items', 'favorites']
  loop
    perform pg_temp.assert_table_privilege('authenticated', relation_name, 'INSERT', true);
    perform pg_temp.assert_table_privilege('authenticated', relation_name, 'UPDATE', true);
    perform pg_temp.assert_table_privilege('authenticated', relation_name, 'DELETE', true);
  end loop;
end;
$assertions$;
select pg_temp.assert_table_privilege('authenticated', 'modifiers', 'INSERT', false);
select pg_temp.assert_table_privilege('authenticated', 'modifier_options', 'UPDATE', false);
select pg_temp.assert_table_privilege('authenticated', 'kyc_documents', 'INSERT', true);
select pg_temp.assert_table_privilege('authenticated', 'kyc_documents', 'UPDATE', false);
select pg_temp.assert_table_privilege('authenticated', 'kyc_documents', 'DELETE', false);
select pg_temp.assert_table_privilege('authenticated', 'push_tokens', 'DELETE', true);
select pg_temp.assert_table_privilege('authenticated', 'push_tokens', 'INSERT', false);
select pg_temp.assert_table_privilege('authenticated', 'push_tokens', 'UPDATE', false);
select pg_temp.assert_table_privilege('authenticated', 'favorite_items', 'INSERT', true);
select pg_temp.assert_table_privilege('authenticated', 'favorite_items', 'DELETE', true);
select pg_temp.assert_table_privilege('authenticated', 'favorite_items', 'UPDATE', false);
select pg_temp.assert_table_privilege('authenticated', 'saved_orders', 'INSERT', true);
select pg_temp.assert_table_privilege('authenticated', 'saved_orders', 'DELETE', true);
select pg_temp.assert_table_privilege('authenticated', 'saved_orders', 'UPDATE', false);
select pg_temp.assert_table_privilege('authenticated', 'customer_carts', 'INSERT', false);
select pg_temp.assert_table_privilege('authenticated', 'customer_carts', 'UPDATE', false);
select pg_temp.assert_column_privilege('authenticated', 'order_messages', 'read_at', 'UPDATE', true);
select pg_temp.assert_column_privilege('authenticated', 'order_messages', 'body', 'UPDATE', false);
select pg_temp.assert_column_privilege('authenticated', 'support_messages', 'read_at', 'UPDATE', true);
select pg_temp.assert_column_privilege('authenticated', 'support_messages', 'body', 'UPDATE', false);

-- Preserve explicitly public-safe later surfaces, but keep secrets private.
select pg_temp.assert_table_privilege('anon', 'public_drivers', 'SELECT', true);
select pg_temp.assert_table_privilege('anon', 'favorite_items', 'SELECT', true);
select pg_temp.assert_table_privilege('anon', 'favorite_items', 'INSERT', true);
select pg_temp.assert_table_privilege('anon', 'favorite_items', 'DELETE', true);
select pg_temp.assert_table_privilege('anon', 'favorite_items', 'UPDATE', false);
select pg_temp.assert_table_privilege('anon', 'customer_carts', 'SELECT', true);
select pg_temp.assert_table_privilege('anon', 'notification_prefs', 'SELECT', true);
select pg_temp.assert_table_privilege('anon', 'platform_settings', 'SELECT', false);

-- Edge/service clients get only the direct operations present in the repo.
select pg_temp.assert_table_privilege('service_role', 'users', 'SELECT', true);
select pg_temp.assert_table_privilege('service_role', 'users', 'UPDATE', false);
select pg_temp.assert_table_privilege('service_role', 'orders', 'SELECT', true);
select pg_temp.assert_table_privilege('service_role', 'orders', 'UPDATE', false);
select pg_temp.assert_table_privilege('service_role', 'notification_prefs', 'SELECT', true);
select pg_temp.assert_table_privilege('service_role', 'platform_settings', 'SELECT', true);
select pg_temp.assert_table_privilege('service_role', 'push_tokens', 'SELECT', true);
select pg_temp.assert_table_privilege('service_role', 'push_tokens', 'DELETE', true);
select pg_temp.assert_table_privilege('service_role', 'push_tokens', 'INSERT', false);
select pg_temp.assert_table_privilege('service_role', 'push_messages', 'SELECT', true);
select pg_temp.assert_table_privilege('service_role', 'push_messages', 'INSERT', true);
select pg_temp.assert_table_privilege('service_role', 'push_messages', 'UPDATE', true);
select pg_temp.assert_table_privilege('service_role', 'push_messages', 'DELETE', false);
select pg_temp.assert_table_privilege('service_role', 'push_attempts', 'SELECT', true);
select pg_temp.assert_table_privilege('service_role', 'push_attempts', 'INSERT', true);
select pg_temp.assert_table_privilege('service_role', 'push_attempts', 'UPDATE', true);
select pg_temp.assert_table_privilege('service_role', 'push_attempts', 'DELETE', false);
select pg_temp.assert_table_privilege('service_role', 'order_status_events', 'INSERT', true);
select pg_temp.assert_table_privilege('service_role', 'order_status_events', 'SELECT', false);
-- scripts/import-menu.mjs: read merchant + catalog, insert sections/items only.
select pg_temp.assert_table_privilege('service_role', 'restaurants', 'SELECT', true);
select pg_temp.assert_table_privilege('service_role', 'restaurants', 'UPDATE', false);
select pg_temp.assert_table_privilege('service_role', 'menu_sections', 'SELECT', true);
select pg_temp.assert_table_privilege('service_role', 'menu_sections', 'INSERT', true);
select pg_temp.assert_table_privilege('service_role', 'menu_sections', 'UPDATE', false);
select pg_temp.assert_table_privilege('service_role', 'menu_sections', 'DELETE', false);
select pg_temp.assert_table_privilege('service_role', 'menu_items', 'SELECT', true);
select pg_temp.assert_table_privilege('service_role', 'menu_items', 'INSERT', true);
select pg_temp.assert_table_privilege('service_role', 'menu_items', 'UPDATE', false);
select pg_temp.assert_table_privilege('service_role', 'menu_items', 'DELETE', false);
select pg_temp.assert_table_privilege('service_role', 'payment_attempts', 'SELECT', true);
select pg_temp.assert_table_privilege('service_role', 'payment_attempts', 'INSERT', true);
select pg_temp.assert_table_privilege('service_role', 'payment_attempts', 'UPDATE', true);
select pg_temp.assert_table_privilege('service_role', 'payment_attempts', 'DELETE', false);
select pg_temp.assert_table_privilege('service_role', 'payment_attempts', 'TRUNCATE', false);
select pg_temp.assert_table_privilege('service_role', 'order_refunds', 'SELECT', true);
select pg_temp.assert_table_privilege('service_role', 'order_refunds', 'INSERT', true);
select pg_temp.assert_table_privilege('service_role', 'order_refunds', 'UPDATE', true);
select pg_temp.assert_table_privilege('service_role', 'order_refunds', 'DELETE', false);
select pg_temp.assert_table_privilege('service_role', 'order_refunds', 'TRUNCATE', false);

-- The refund client projection remains column-restricted.
select pg_temp.assert_table_privilege('authenticated', 'order_refunds', 'SELECT', false);
select pg_temp.assert_column_privilege('authenticated', 'order_refunds', 'status', 'SELECT', true);
select pg_temp.assert_column_privilege('authenticated', 'order_refunds', 'provider_detail', 'SELECT', false);
select pg_temp.assert_column_privilege('authenticated', 'order_refunds', 'actor_id', 'SELECT', false);

-- The legacy RPCs now have explicit transport ACLs rather than leaking through
-- PUBLIC. service_role is an unrelated-role probe here: if PUBLIC survived,
-- every one of these negative assertions would become true.
do $assertions$
declare
  signature text;
begin
  foreach signature in array array[
    'public.get_restaurant_reviews(uuid,integer)',
    'public.quote_delivery_fee(uuid,public.geography,integer)'
  ]
  loop
    if not has_function_privilege('anon', signature, 'EXECUTE')
       or not has_function_privilege('authenticated', signature, 'EXECUTE')
       or has_function_privilege('service_role', signature, 'EXECUTE')
    then
      raise exception 'public read RPC ACL is not explicit: %', signature;
    end if;
  end loop;

  foreach signature in array array[
    'public.my_loyalty_status()',
    'public.my_loyalty_history(integer)',
    'public.my_driver_tier()',
    'public.my_restaurant_tier()',
    'public.my_referral_code()'
  ]
  loop
    if has_function_privilege('anon', signature, 'EXECUTE')
       or not has_function_privilege('authenticated', signature, 'EXECUTE')
       or has_function_privilege('service_role', signature, 'EXECUTE')
    then
      raise exception 'authenticated-only RPC ACL is not explicit: %', signature;
    end if;
  end loop;
end;
$assertions$;

-- postgres-owned future objects are closed by the migration itself.
set role postgres;
create table public.__grant_probe_postgres_table (id integer);
create sequence public.__grant_probe_postgres_sequence;
create function public.__grant_probe_postgres_function()
returns integer language sql as 'select 1';
reset role;

-- Hosted postgres cannot repair supabase_admin's defaults. Prove that the
-- migration completed without pretending otherwise, then model the documented
-- platform-owner follow-up and prove objects created after it start closed.
set role supabase_admin;
create table public.__grant_probe_supabase_admin_before_followup_table (id integer);
create sequence public.__grant_probe_supabase_admin_before_followup_sequence;
create function public.__grant_probe_supabase_admin_before_followup_function()
returns integer language sql as 'select 1';
reset role;

do $assertions$
begin
  if not has_table_privilege(
    'anon',
    'public.__grant_probe_supabase_admin_before_followup_table',
    'SELECT'
  ) or not has_sequence_privilege(
    'authenticated',
    'public.__grant_probe_supabase_admin_before_followup_sequence',
    'USAGE'
  ) or not has_function_privilege(
    'service_role',
    'public.__grant_probe_supabase_admin_before_followup_function()',
    'EXECUTE'
  ) then
    raise exception 'test fixture no longer demonstrates the required supabase_admin live follow-up';
  end if;
end;
$assertions$;

set role supabase_admin;
alter default privileges for role supabase_admin
  revoke all privileges on tables
  from public, anon, authenticated, service_role;
alter default privileges for role supabase_admin
  revoke all privileges on sequences
  from public, anon, authenticated, service_role;
alter default privileges for role supabase_admin
  revoke all privileges on functions
  from public, anon, authenticated, service_role;
alter default privileges for role supabase_admin in schema public
  revoke all privileges on tables
  from public, anon, authenticated, service_role;
alter default privileges for role supabase_admin in schema public
  revoke all privileges on sequences
  from public, anon, authenticated, service_role;
alter default privileges for role supabase_admin in schema public
  revoke all privileges on functions
  from public, anon, authenticated, service_role;
create table public.__grant_probe_supabase_admin_after_followup_table (id integer);
create sequence public.__grant_probe_supabase_admin_after_followup_sequence;
create function public.__grant_probe_supabase_admin_after_followup_function()
returns integer language sql as 'select 1';
reset role;

do $assertions$
declare
  role_name text;
  grantor_name text;
begin
  foreach role_name in array array['anon', 'authenticated', 'service_role']
  loop
    foreach grantor_name in array array['postgres', 'supabase_admin_after_followup']
    loop
      if has_table_privilege(
        role_name,
        format('public.__grant_probe_%s_table', grantor_name),
        'SELECT,INSERT,UPDATE,DELETE,TRUNCATE'
      ) then
        raise exception '% inherited table access from % default ACL',
          role_name, grantor_name;
      end if;
      if has_sequence_privilege(
        role_name,
        format('public.__grant_probe_%s_sequence', grantor_name),
        'USAGE'
      ) then
        raise exception '% inherited sequence access from % default ACL',
          role_name, grantor_name;
      end if;
      if has_function_privilege(
        role_name,
        format('public.__grant_probe_%s_function()', grantor_name),
        'EXECUTE'
      ) then
        raise exception '% inherited function access from % default ACL',
          role_name, grantor_name;
      end if;
    end loop;
  end loop;

  if not has_schema_privilege('anon', 'public', 'USAGE')
     or not has_schema_privilege('authenticated', 'public', 'USAGE')
     or not has_schema_privilege('service_role', 'public', 'USAGE')
  then
    raise exception 'Data API roles require public schema USAGE';
  end if;
  if has_schema_privilege('anon', 'public', 'CREATE')
     or has_schema_privilege('authenticated', 'public', 'CREATE')
     or has_schema_privilege('service_role', 'public', 'CREATE')
  then
    raise exception 'Data API roles must not create objects in public';
  end if;
end;
$assertions$;

rollback;
