\set ON_ERROR_STOP on

-- Self-contained regression harness. A sentinel stands in for the current
-- place_order body so this proves the migration wraps it without copying it.
begin;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin; end if;
end;
$$;

create schema private;
revoke all on schema private from public, anon, authenticated;
create type public.dropoff_preference as enum ('door', 'reception', 'meet_outside');
create type public.allergy_key_type as enum ('dairy', 'eggs', 'gluten', 'nuts');

-- auth.uid() stand-in: the validator asks about the ORDER'S CUSTOMER because
-- it runs under the SECURITY DEFINER wrapper. pg_temp.set_uid() switches it.
create schema auth;
create table pg_temp.current_uid (uid uuid);
insert into pg_temp.current_uid values ('7a000000-0000-0000-0000-000000000001');
create function auth.uid() returns uuid language sql stable
as $$ select uid from pg_temp.current_uid limit 1 $$;
create function pg_temp.set_uid(p uuid) returns void language sql
as $$ update pg_temp.current_uid set uid = p $$;

-- Vertical visibility stand-in (mig 159 semantics: 'public' = everyone,
-- anything else = nobody in this fixture).
create function public.user_can_view_vertical(p_user_id uuid, p_vertical_id text)
returns boolean language sql stable
as $$ select p_vertical_id = 'food' $$;

create table public.restaurants (
  id uuid primary key,
  is_active boolean not null default true,
  vertical_id text not null default 'food'
);
insert into public.restaurants values
  ('70000000-0000-0000-0000-000000000001', true,  'food'),      -- the merchant ordered from
  ('70000000-0000-0000-0000-000000000009', true,  'food'),      -- another visible merchant
  ('70000000-0000-0000-0000-000000000008', true,  'pharmacy'),  -- hidden vertical
  ('70000000-0000-0000-0000-000000000007', false, 'food');      -- deactivated merchant

create table public.menu_items (
  id uuid primary key,
  name text not null,
  restaurant_id uuid not null references public.restaurants(id)
    default '70000000-0000-0000-0000-000000000001',
  is_available boolean not null default true
);
create table public.modifiers (
  id uuid primary key,
  item_id uuid not null references public.menu_items(id),
  name text not null,
  required boolean not null default false,
  min_select integer not null default 0,
  max_select integer not null default 1
);
create table public.modifier_options (
  id uuid primary key,
  modifier_id uuid not null references public.modifiers(id),
  name text not null
);

create function public.place_order(
  p_restaurant_id uuid,
  p_address_id uuid,
  p_cart jsonb,
  p_payment_method text,
  p_tip integer default 0,
  p_kitchen_notes text default null,
  p_promo_code text default null,
  p_scheduled_for timestamp with time zone default null,
  p_customer_phone text default null,
  p_idempotency_key uuid default null,
  p_dropoff_preference public.dropoff_preference default null,
  p_dropoff_note text default null,
  p_aggregate_allergens public.allergy_key_type[] default null
)
returns table(id uuid, short_code text, total_egp integer)
language sql security definer set search_path = public, pg_temp
as $$
  select '73000000-0000-0000-0000-000000000001'::uuid, 'SE-TEST'::text, 731::integer
$$;
revoke all on function public.place_order(
  uuid, uuid, jsonb, text, integer, text, text, timestamp with time zone,
  text, uuid, public.dropoff_preference, text, public.allergy_key_type[]
) from public, anon;
grant execute on function public.place_order(
  uuid, uuid, jsonb, text, integer, text, text, timestamp with time zone,
  text, uuid, public.dropoff_preference, text, public.allergy_key_type[]
) to authenticated, service_role;

insert into public.menu_items (id, name) values
  ('71000000-0000-0000-0000-000000000001', 'Configured item'),
  ('71000000-0000-0000-0000-000000000002', 'Other item'),
  ('71000000-0000-0000-0000-000000000003', 'No modifiers');
-- Items the delegate would reject BEFORE modifier pricing. The validator must
-- fall through for every one of them, so their modifier structure stays
-- unobservable (the existence oracle closed by migs 153/162).
insert into public.menu_items (id, name, restaurant_id, is_available) values
  ('71000000-0000-0000-0000-000000000004', 'Foreign merchant item', '70000000-0000-0000-0000-000000000009', true),
  ('71000000-0000-0000-0000-000000000005', 'Hidden vertical item',  '70000000-0000-0000-0000-000000000008', true),
  ('71000000-0000-0000-0000-000000000006', 'Deactivated merchant item', '70000000-0000-0000-0000-000000000007', true),
  ('71000000-0000-0000-0000-000000000007', 'Unavailable item', '70000000-0000-0000-0000-000000000001', false);
insert into public.modifiers values
  ('72000000-0000-0000-0000-000000000001', '71000000-0000-0000-0000-000000000001', 'Size', true, 0, 1),
  ('72000000-0000-0000-0000-000000000002', '71000000-0000-0000-0000-000000000001', 'Two sides', true, 2, 2),
  ('72000000-0000-0000-0000-000000000003', '71000000-0000-0000-0000-000000000001', 'Sauces', false, 0, 2),
  ('72000000-0000-0000-0000-000000000004', '71000000-0000-0000-0000-000000000001', 'Optional pair', false, 2, 3),
  ('72000000-0000-0000-0000-000000000005', '71000000-0000-0000-0000-000000000002', 'Other size', false, 0, 1),
  -- every out-of-scope item carries a REQUIRED group, so a leaky validator
  -- would raise MODIFIER_MIN_SELECTION for an empty selection
  ('72000000-0000-0000-0000-000000000006', '71000000-0000-0000-0000-000000000004', 'Foreign size', true, 1, 1),
  ('72000000-0000-0000-0000-000000000007', '71000000-0000-0000-0000-000000000005', 'Hidden size', true, 1, 1),
  ('72000000-0000-0000-0000-000000000008', '71000000-0000-0000-0000-000000000006', 'Deactivated size', true, 1, 1),
  ('72000000-0000-0000-0000-000000000009', '71000000-0000-0000-0000-000000000007', 'Unavailable size', true, 1, 1);
insert into public.modifier_options values
  ('73000000-0000-0000-0000-000000000001', '72000000-0000-0000-0000-000000000001', 'Regular'),
  ('73000000-0000-0000-0000-000000000002', '72000000-0000-0000-0000-000000000001', 'Large'),
  ('73000000-0000-0000-0000-000000000003', '72000000-0000-0000-0000-000000000002', 'Fries'),
  ('73000000-0000-0000-0000-000000000004', '72000000-0000-0000-0000-000000000002', 'Salad'),
  ('73000000-0000-0000-0000-000000000005', '72000000-0000-0000-0000-000000000003', 'Garlic'),
  ('73000000-0000-0000-0000-000000000006', '72000000-0000-0000-0000-000000000003', 'Chilli'),
  ('73000000-0000-0000-0000-000000000007', '72000000-0000-0000-0000-000000000003', 'Tahini'),
  ('73000000-0000-0000-0000-000000000008', '72000000-0000-0000-0000-000000000004', 'Pickles'),
  ('73000000-0000-0000-0000-000000000009', '72000000-0000-0000-0000-000000000004', 'Olives'),
  ('73000000-0000-0000-0000-000000000010', '72000000-0000-0000-0000-000000000005', 'Foreign option');

\ir ../migrations/20260815044234_enforce_order_modifier_invariants.sql

create function pg_temp.cart(p_item uuid, p_options uuid[])
returns jsonb language sql
as $$
  select jsonb_build_array(jsonb_build_object(
    'item_id', p_item, 'quantity', 1, 'modifier_option_ids', to_jsonb(p_options)
  ))
$$;

create function pg_temp.assert_rejected(p_item uuid, p_options uuid[], p_code text)
returns void language plpgsql
as $$
begin
  begin
    perform public.place_order(
      '70000000-0000-0000-0000-000000000001',
      '70000000-0000-0000-0000-000000000002',
      pg_temp.cart(p_item, p_options), 'cash_on_delivery'
    );
    raise exception 'expected %, but invalid cart was accepted', p_code;
  exception when check_violation then
    if sqlerrm <> p_code then raise exception 'expected %, got %', p_code, sqlerrm; end if;
  end;
end;
$$;

-- Valid selection reaches the preserved implementation (sentinel = 731).
do $$
declare v_total integer;
begin
  select total_egp into v_total from public.place_order(
    '70000000-0000-0000-0000-000000000001',
    '70000000-0000-0000-0000-000000000002',
    pg_temp.cart('71000000-0000-0000-0000-000000000001', array[
      '73000000-0000-0000-0000-000000000001',
      '73000000-0000-0000-0000-000000000003',
      '73000000-0000-0000-0000-000000000004'
    ]::uuid[]), 'cash_on_delivery'
  );
  if v_total <> 731 then raise exception 'valid cart did not reach old place_order body'; end if;
end;
$$;

-- Missing required group, min_select, optional min once used, and max_select.
select pg_temp.assert_rejected('71000000-0000-0000-0000-000000000001', array[
  '73000000-0000-0000-0000-000000000003', '73000000-0000-0000-0000-000000000004'
]::uuid[], 'MODIFIER_MIN_SELECTION');
select pg_temp.assert_rejected('71000000-0000-0000-0000-000000000001', array[
  '73000000-0000-0000-0000-000000000001', '73000000-0000-0000-0000-000000000003'
]::uuid[], 'MODIFIER_MIN_SELECTION');
select pg_temp.assert_rejected('71000000-0000-0000-0000-000000000001', array[
  '73000000-0000-0000-0000-000000000001', '73000000-0000-0000-0000-000000000003',
  '73000000-0000-0000-0000-000000000004', '73000000-0000-0000-0000-000000000008'
]::uuid[], 'MODIFIER_MIN_SELECTION');
select pg_temp.assert_rejected('71000000-0000-0000-0000-000000000001', array[
  '73000000-0000-0000-0000-000000000001', '73000000-0000-0000-0000-000000000003',
  '73000000-0000-0000-0000-000000000004', '73000000-0000-0000-0000-000000000005',
  '73000000-0000-0000-0000-000000000006', '73000000-0000-0000-0000-000000000007'
]::uuid[], 'MODIFIER_MAX_SELECTION');

-- Stale/unknown, cross-item, and duplicate IDs may not be silently dropped.
select pg_temp.assert_rejected('71000000-0000-0000-0000-000000000003',
  array['73000000-0000-0000-0000-000000000099']::uuid[], 'INVALID_MODIFIER_OPTION');
select pg_temp.assert_rejected('71000000-0000-0000-0000-000000000003',
  array['73000000-0000-0000-0000-000000000010']::uuid[], 'INVALID_MODIFIER_OPTION');
select pg_temp.assert_rejected('71000000-0000-0000-0000-000000000003', array[
  '73000000-0000-0000-0000-000000000010', '73000000-0000-0000-0000-000000000010'
]::uuid[], 'DUPLICATE_MODIFIER_OPTION');

-- Existence-oracle guard: lines the delegate rejects before modifier pricing
-- (foreign merchant, hidden vertical, deactivated merchant, unavailable item,
-- and any call without a customer identity) must fall straight through to the
-- delegate — here the sentinel — even with a missing required group or a
-- bogus option id. In production the delegate then raises its collapsed
-- MERCHANT_NOT_FOUND / ITEM_NOT_FOUND / ITEM_UNAVAILABLE / AUTH_REQUIRED.
create function pg_temp.assert_falls_through(p_item uuid, p_options uuid[], p_why text)
returns void language plpgsql
as $$
declare v_total integer;
begin
  begin
    select total_egp into v_total from public.place_order(
      '70000000-0000-0000-0000-000000000001',
      '70000000-0000-0000-0000-000000000002',
      pg_temp.cart(p_item, p_options), 'cash_on_delivery'
    );
  exception when check_violation then
    raise exception 'validator leaked % (%): raised % before the delegate ran', p_why, p_item, sqlerrm;
  end;
  if v_total <> 731 then raise exception '% did not reach the delegate', p_why; end if;
end;
$$;

select pg_temp.assert_falls_through('71000000-0000-0000-0000-000000000004', '{}'::uuid[], 'foreign-merchant item');
select pg_temp.assert_falls_through('71000000-0000-0000-0000-000000000004',
  array['73000000-0000-0000-0000-000000000099']::uuid[], 'foreign-merchant item with bogus option');
select pg_temp.assert_falls_through('71000000-0000-0000-0000-000000000005', '{}'::uuid[], 'hidden-vertical item');
select pg_temp.assert_falls_through('71000000-0000-0000-0000-000000000005',
  array['73000000-0000-0000-0000-000000000099']::uuid[], 'hidden-vertical item with bogus option');
select pg_temp.assert_falls_through('71000000-0000-0000-0000-000000000006', '{}'::uuid[], 'deactivated-merchant item');
select pg_temp.assert_falls_through('71000000-0000-0000-0000-000000000007', '{}'::uuid[], 'unavailable item');
-- Same visible item, but no customer identity (service-role/anonymous call):
-- the delegate owns AUTH_REQUIRED, the validator must stay silent.
select pg_temp.set_uid(null);
select pg_temp.assert_falls_through('71000000-0000-0000-0000-000000000001', '{}'::uuid[], 'call without auth.uid()');
select pg_temp.set_uid('7a000000-0000-0000-0000-000000000001');
-- ...and the same visible item IS still validated once identity is present.
select pg_temp.assert_rejected('71000000-0000-0000-0000-000000000001', '{}'::uuid[], 'MODIFIER_MIN_SELECTION');

do $$
declare
  sig text := 'uuid,uuid,jsonb,text,integer,text,text,timestamp with time zone,text,uuid,' ||
              'public.dropoff_preference,text,public.allergy_key_type[]';
begin
  if (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'place_order') <> 1 then
    raise exception 'public place_order must retain exactly one overload';
  end if;
  if not has_function_privilege('authenticated', 'public.place_order(' || sig || ')', 'EXECUTE') then
    raise exception 'authenticated lost place_order execute';
  end if;
  if has_function_privilege('anon', 'public.place_order(' || sig || ')', 'EXECUTE') then
    raise exception 'anon gained place_order execute';
  end if;
  if has_function_privilege('authenticated', 'private.place_order(' || sig || ')', 'EXECUTE') then
    raise exception 'authenticated can bypass validation';
  end if;
  if has_function_privilege('authenticated', 'private.assert_order_modifier_invariants(uuid, jsonb)', 'EXECUTE') then
    raise exception 'authenticated can execute private validator';
  end if;
end;
$$;

rollback;
