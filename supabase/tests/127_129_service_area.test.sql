\set ON_ERROR_STOP on

-- Tests for migrations 127 (vertical-aware delivery fee), 128 (zone distance
-- guard -- settings knob only here; the geometry runs in the prod dry run),
-- and 129 (service-area single source).
--
-- Same methodology split as the 126 suite: PostGIS-free logic is exercised
-- here with shims; the REAL bodies run against the REAL schema in
-- supabase/tests/126_129_dryrun_prod.sql (BEGIN/ROLLBACK in the Dashboard).

begin;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
end;
$$;

create type zone_type as enum ('naama','hadaba','nabq');

create table public.platform_settings (key text primary key, value jsonb not null);

create table public.verticals (id text primary key);
insert into public.verticals (id) values ('food'), ('grocery');

create table public.zones (id zone_type primary key, is_active boolean not null default true);
insert into public.zones (id) values ('naama'), ('hadaba');

create table public.restaurants (
  id          uuid primary key default gen_random_uuid(),
  vertical_id text references public.verticals(id) default 'food'
);

create table public.delivery_fee_rules (
  id          uuid primary key default gen_random_uuid(),
  zone_id     zone_type references public.zones(id),
  vertical_id text references public.verticals(id),
  base_fee    int not null default 25,
  per_km_fee  int not null default 0,
  min_fee     int not null default 0,
  free_over   int
);
create unique index delivery_fee_rules_zone_vertical_uniq
  on public.delivery_fee_rules (zone_id, coalesce(vertical_id, ''));

-- geography shimmed as text; resolve_zone_nearest shimmed to a constant --
-- 127's change is the RULE PREFERENCE, which is what this file tests.
create function public.resolve_zone_nearest(p_geo text) returns zone_type
language sql stable as $$ select 'naama'::zone_type $$;

-- ===========================================================================
-- Install 129's helper (real body -- it is PostGIS-free).
-- ===========================================================================
insert into public.platform_settings (key, value)
values ('service_area_bbox',
        jsonb_build_object('lat_min', 27.70, 'lat_max', 28.35,
                           'lng_min', 34.20, 'lng_max', 34.70))
on conflict (key) do nothing;

create function public.is_within_service_area(p_lat double precision, p_lng double precision)
returns boolean
language sql
stable
set search_path to 'public', 'pg_temp'
as $function$
  select p_lat is not null and p_lng is not null
     and p_lat between coalesce((select (value ->> 'lat_min')::float8 from public.platform_settings where key = 'service_area_bbox'), 27.70)
                   and coalesce((select (value ->> 'lat_max')::float8 from public.platform_settings where key = 'service_area_bbox'), 28.35)
     and p_lng between coalesce((select (value ->> 'lng_min')::float8 from public.platform_settings where key = 'service_area_bbox'), 34.20)
                   and coalesce((select (value ->> 'lng_max')::float8 from public.platform_settings where key = 'service_area_bbox'), 34.70);
$function$;

-- ===========================================================================
-- TEST 1 -- helper truth table: inside, all four outside directions, exact
-- corners (between is inclusive), NULLs fail closed.
-- ===========================================================================
do $$
begin
  if not public.is_within_service_area(27.9, 34.4) then
    raise exception 'TEST 1 FAILED: central Sharm point rejected';
  end if;
  if public.is_within_service_area(30.04, 31.24) then
    raise exception 'TEST 1 FAILED: Cairo accepted';
  end if;
  if public.is_within_service_area(27.69, 34.4) or public.is_within_service_area(28.36, 34.4)
     or public.is_within_service_area(27.9, 34.19) or public.is_within_service_area(27.9, 34.71) then
    raise exception 'TEST 1 FAILED: a just-outside point was accepted';
  end if;
  if not (public.is_within_service_area(27.70, 34.20) and public.is_within_service_area(28.35, 34.70)) then
    raise exception 'TEST 1 FAILED: inclusive corners rejected';
  end if;
  if public.is_within_service_area(null, 34.4) or public.is_within_service_area(27.9, null) then
    raise exception 'TEST 1 FAILED: NULL input must fail closed';
  end if;
  raise notice 'test 1 OK: bbox truth table (inside/outside/corners/NULLs)';
end;
$$;

-- ===========================================================================
-- TEST 2 -- the box is DATA: shrinking the settings row changes the answer,
-- deleting it falls back to the hardcoded Sharm box (fail-safe).
-- ===========================================================================
do $$
begin
  update public.platform_settings
     set value = jsonb_build_object('lat_min', 27.0, 'lat_max', 27.5,
                                    'lng_min', 33.0, 'lng_max', 33.5)
   where key = 'service_area_bbox';
  if public.is_within_service_area(27.9, 34.4) then
    raise exception 'TEST 2 FAILED: old box still accepted after settings change';
  end if;
  if not public.is_within_service_area(27.2, 33.2) then
    raise exception 'TEST 2 FAILED: new box not honoured';
  end if;

  delete from public.platform_settings where key = 'service_area_bbox';
  if not public.is_within_service_area(27.9, 34.4) then
    raise exception 'TEST 2 FAILED: hardcoded fallback not honoured after row deletion';
  end if;

  -- restore for later tests
  insert into public.platform_settings (key, value)
  values ('service_area_bbox',
          jsonb_build_object('lat_min', 27.70, 'lat_max', 28.35,
                             'lng_min', 34.20, 'lng_max', 34.70));
  raise notice 'test 2 OK: city #2 is a settings change; deletion falls back safely';
end;
$$;

-- ===========================================================================
-- Install 127's quote_delivery_fee (real body over the shims).
-- ===========================================================================
create function public.quote_delivery_fee(p_restaurant_id uuid, p_dropoff text, p_subtotal integer default 0)
returns integer
language plpgsql
stable
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_zone     zone_type;
  v_vertical text;
  v_rule     public.delivery_fee_rules;
  v_fee      int;
begin
  v_zone := public.resolve_zone_nearest(p_dropoff);
  select coalesce(r.vertical_id, 'food') into v_vertical
    from public.restaurants r where r.id = p_restaurant_id;
  v_vertical := coalesce(v_vertical, 'food');
  select * into v_rule from public.delivery_fee_rules
   where zone_id = v_zone and (vertical_id = v_vertical or vertical_id is null)
   order by vertical_id nulls last
   limit 1;
  if not found then
    return 30;
  end if;
  if v_rule.free_over is not null and p_subtotal >= v_rule.free_over then
    return 0;
  end if;
  v_fee := greatest(v_rule.base_fee, v_rule.min_fee);
  return v_fee;
end;
$function$;

-- ===========================================================================
-- TEST 3 -- vertical preference. Naama has a NULL-vertical rule (25) and a
-- grocery rule (40). NEGATIVE CONTROL first: the OLD hardcoded-'food' filter
-- gives the grocery merchant 25; the fix gives 40. Food merchants and
-- rule-less zones behave exactly as before.
-- ===========================================================================
do $$
declare
  v_food    uuid;
  v_grocery uuid;
  v_fee     int;
begin
  insert into public.restaurants (vertical_id) values ('food') returning id into v_food;
  insert into public.restaurants (vertical_id) values ('grocery') returning id into v_grocery;
  insert into public.delivery_fee_rules (zone_id, vertical_id, base_fee) values
    ('naama', null, 25),
    ('naama', 'grocery', 40);

  -- NEGATIVE CONTROL: the old filter shape misprices the grocery merchant.
  select base_fee into v_fee from public.delivery_fee_rules
   where zone_id = 'naama' and (vertical_id = 'food' or vertical_id is null)
   order by vertical_id nulls last limit 1;
  if v_fee <> 25 then
    raise exception 'NEGATIVE CONTROL FAILED: expected the old filter to fall back to 25, got %', v_fee;
  end if;
  raise notice 'negative control OK: hardcoded-food filter gives a grocery merchant the 25 fallback';

  select public.quote_delivery_fee(v_grocery, 'x') into v_fee;
  if v_fee <> 40 then
    raise exception 'TEST 3 FAILED: grocery merchant should get the grocery rule (40), got %', v_fee;
  end if;
  select public.quote_delivery_fee(v_food, 'x') into v_fee;
  if v_fee <> 25 then
    raise exception 'TEST 3 FAILED: food merchant should fall back to the NULL-vertical rule (25), got %', v_fee;
  end if;
  -- Unknown merchant behaves as before (food -> fallback rule).
  select public.quote_delivery_fee(gen_random_uuid(), 'x') into v_fee;
  if v_fee <> 25 then
    raise exception 'TEST 3 FAILED: unknown merchant should behave as food (25), got %', v_fee;
  end if;
  raise notice 'test 3 OK: vertical rule preferred (40), food + unknown fall back (25)';
end;
$$;

-- ===========================================================================
-- TEST 4 -- free_over and the no-rule default still behave exactly as prod.
-- ===========================================================================
do $$
declare
  v_food uuid;
  v_fee  int;
begin
  select id into v_food from public.restaurants where vertical_id = 'food' limit 1;
  update public.delivery_fee_rules set free_over = 300 where zone_id = 'naama' and vertical_id is null;
  select public.quote_delivery_fee(v_food, 'x', 300) into v_fee;
  if v_fee <> 0 then
    raise exception 'TEST 4 FAILED: free_over not honoured, got %', v_fee;
  end if;
  delete from public.delivery_fee_rules;
  select public.quote_delivery_fee(v_food, 'x') into v_fee;
  if v_fee <> 30 then
    raise exception 'TEST 4 FAILED: no-rule default should be 30, got %', v_fee;
  end if;
  raise notice 'test 4 OK: free_over and the 30 EGP no-rule default unchanged';
end;
$$;

do $$ begin raise notice 'ALL 127-129 SERVICE AREA TESTS PASSED'; end; $$;

rollback;
