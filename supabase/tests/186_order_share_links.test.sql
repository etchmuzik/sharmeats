\set ON_ERROR_STOP on

-- Transaction-wrapped so nothing persists (migration house rule 6).
begin;

create extension if not exists pgcrypto;

-- PostGIS is not installed in the harness, so geography is shimmed as text —
-- the same approach 127_129_service_area.test.sql takes ("geography shimmed as
-- text"). Coordinates travel as 'lng,lat' so the migration's st_x/st_y calls run
-- unchanged. What this file tests is the AUTHORITY and the position GATING, not
-- PostGIS arithmetic.
create domain geography as text;
create domain geometry as text;

create function st_makepoint(p_lng double precision, p_lat double precision)
returns text language sql immutable as $shim$
  select p_lng::text || ',' || p_lat::text
$shim$;

create function st_setsrid(p_point text, p_srid int)
returns text language sql immutable as $shim$
  select p_point
$shim$;

create function st_x(p_point text)
returns double precision language sql immutable as $shim$
  select nullif(split_part(p_point, ',', 1), '')::double precision
$shim$;

create function st_y(p_point text)
returns double precision language sql immutable as $shim$
  select nullif(split_part(p_point, ',', 2), '')::double precision
$shim$;

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
grant usage on schema auth to authenticated, anon;
grant execute on function auth.uid() to authenticated, anon;

create type order_status_type as enum (
  'placed','accepted','preparing','ready','picked_up','out_for_delivery',
  'delivered','cancelled','rejected'
);
create type vehicle_type as enum ('scooter','bicycle','car','walk');

create table public.users (id uuid primary key);

create table public.restaurants (
  id   uuid primary key,
  name text not null,
  geo  geography
);

create table public.drivers (
  id           uuid primary key,
  name         text not null,
  phone        text not null default '',
  vehicle      vehicle_type not null default 'scooter',
  rating       numeric(2,1) not null default 5.0,
  current_geo  geography,
  last_ping_at timestamptz
);

create table public.orders (
  id                 uuid primary key,
  short_code         text not null unique,
  user_id            uuid references public.users(id),
  restaurant_id      uuid references public.restaurants(id),
  assigned_driver_id uuid references public.drivers(id),
  status             order_status_type not null default 'placed',
  eta_at             timestamptz,
  placed_at          timestamptz not null default now(),
  delivered_at       timestamptz,
  -- Present so the test can prove these NEVER surface through the share.
  total_egp          int not null default 0,
  customer_phone     text,
  address_snapshot   jsonb
);

\ir ../migrations/186_order_share_links.sql

insert into public.users (id) values
  ('70000000-0000-0000-0000-000000000001'),   -- customer who orders
  ('70000000-0000-0000-0000-000000000002');   -- an unrelated signed-in user

insert into public.restaurants (id, name, geo) values
  ('71000000-0000-0000-0000-000000000001', 'Koshary House',
   st_setsrid(st_makepoint(34.3300, 27.9150), 4326)::geography);

insert into public.drivers (id, name, phone, vehicle, rating, current_geo, last_ping_at) values
  ('72000000-0000-0000-0000-000000000001', 'Mahmoud El Sayed', '+201000000000',
   'scooter', 4.8,
   st_setsrid(st_makepoint(34.3400, 27.9200), 4326)::geography,
   now());

insert into public.orders
  (id, short_code, user_id, restaurant_id, assigned_driver_id, status, eta_at,
   total_egp, customer_phone, address_snapshot)
values
  ('73000000-0000-0000-0000-000000000001', 'LIVE01',
   '70000000-0000-0000-0000-000000000001', '71000000-0000-0000-0000-000000000001',
   '72000000-0000-0000-0000-000000000001', 'out_for_delivery', now() + interval '15 min',
   450, '+201111111111',
   '{"hotelName":"Four Seasons","roomNumber":"812","streetText":"Om El Sid"}'::jsonb),
  -- Terminal, used for the "cannot share a finished order" case.
  ('73000000-0000-0000-0000-000000000002', 'DONE02',
   '70000000-0000-0000-0000-000000000001', '71000000-0000-0000-0000-000000000001',
   '72000000-0000-0000-0000-000000000001', 'delivered', now(),
   300, '+201111111111', '{"roomNumber":"812"}'::jsonb);

-- ---------------------------------------------------------------------------
-- Minting: owner only, live orders only, idempotent.
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claim.sub', '70000000-0000-0000-0000-000000000001', true);
set local role authenticated;

do $$
declare
  v_a text;
  v_b text;
begin
  v_a := public.create_order_share('73000000-0000-0000-0000-000000000001');
  if v_a is null or length(v_a) <> 32 then
    raise exception 'expected a 32-char hex token, got %', coalesce(v_a, 'null');
  end if;
  if v_a !~ '^[0-9a-f]{32}$' then
    raise exception 'token must be URL-safe hex, got %', v_a;
  end if;

  -- Idempotent: a second tap must NOT invalidate the link already sent.
  v_b := public.create_order_share('73000000-0000-0000-0000-000000000001');
  if v_b is distinct from v_a then
    raise exception 're-sharing changed the token (% -> %)', v_a, v_b;
  end if;

  -- A finished order cannot be turned into a durable beacon.
  begin
    perform public.create_order_share('73000000-0000-0000-0000-000000000002');
    raise exception 'sharing a delivered order should be refused';
  exception when check_violation then null;
  end;
end;
$$;

-- A different signed-in user cannot share somebody else's delivery.
select set_config('request.jwt.claim.sub', '70000000-0000-0000-0000-000000000002', true);
do $$
begin
  begin
    perform public.create_order_share('73000000-0000-0000-0000-000000000001');
    raise exception 'a stranger should not be able to share this order';
  exception when check_violation then null;
  end;

  -- Nor read the owner's share row.
  if exists (select 1 from public.order_shares) then
    raise exception 'order_shares must not be readable by another user';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- The anonymous view. This is the heart of it: what a forwarded link reveals.
-- ---------------------------------------------------------------------------
reset role;
do $$
declare
  v_token text;
  v_row   record;
begin
  select token into v_token from public.order_shares
   where order_id = '73000000-0000-0000-0000-000000000001';

  set local role anon;
  select * into v_row from public.get_shared_order(v_token);

  if v_row.short_code is distinct from 'LIVE01' then
    raise exception 'expected the order short code, got %', coalesce(v_row.short_code, 'null');
  end if;
  if v_row.status is distinct from 'out_for_delivery' then
    raise exception 'expected the live status, got %', coalesce(v_row.status, 'null');
  end if;
  if v_row.restaurant_name is distinct from 'Koshary House' then
    raise exception 'expected the restaurant name, got %', coalesce(v_row.restaurant_name, 'null');
  end if;

  -- Courier is masked to a first name.
  if v_row.driver_name is distinct from 'Mahmoud' then
    raise exception 'driver should be first-name only, got %', coalesce(v_row.driver_name, 'null');
  end if;

  -- In motion, so the dot is present.
  if v_row.driver_lat is null or v_row.driver_lng is null then
    raise exception 'a moving delivery should expose the driver position';
  end if;

  -- Restaurant pin gives the dot context. A restaurant is a public business.
  if v_row.restaurant_lat is null or v_row.restaurant_lng is null then
    raise exception 'the pickup pin should be present';
  end if;
  reset role;
end;
$$;

-- The projection cannot carry what it does not have a column for. Assert the
-- SHAPE, so that adding an address or phone column later trips this test rather
-- than quietly shipping in a forwardable link.
do $$
declare
  v_cols text[];
begin
  select array_agg(p.proargnames[i] order by i) into v_cols
    from pg_proc p, generate_subscripts(p.proargnames, 1) i
    join pg_namespace n on true
   where p.proname = 'get_shared_order'
     and n.oid = p.pronamespace and n.nspname = 'public'
     and p.proargmodes[i] = 't';

  if v_cols is distinct from array[
    'short_code','status','eta_at','restaurant_name','restaurant_lat','restaurant_lng',
    'driver_name','driver_vehicle','driver_rating','driver_lat','driver_lng','driver_pinged_at'
  ] then
    raise exception 'get_shared_order output columns changed: %', coalesce(v_cols::text, 'null');
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- THE SUBTLE ONE. After delivery the driver's last position IS the customer's
-- doorstep, so the dot must disappear even though the link is still inside its
-- grace window and still answering.
-- ---------------------------------------------------------------------------
do $$
declare
  v_token text;
  v_row   record;
begin
  select token into v_token from public.order_shares
   where order_id = '73000000-0000-0000-0000-000000000001';

  update public.orders
     set status = 'delivered', delivered_at = now()
   where id = '73000000-0000-0000-0000-000000000001';

  set local role anon;
  select * into v_row from public.get_shared_order(v_token);

  if v_row is null then
    raise exception 'within the grace window the link should still answer';
  end if;
  if v_row.status is distinct from 'delivered' then
    raise exception 'expected delivered, got %', coalesce(v_row.status, 'null');
  end if;
  if v_row.driver_lat is not null or v_row.driver_lng is not null then
    raise exception 'a delivered order must NOT expose the driver position — it is the address';
  end if;
  if v_row.driver_pinged_at is not null then
    raise exception 'the ping timestamp leaks motion after delivery';
  end if;
  reset role;
end;
$$;

-- Before pickup there is likewise no dot (the driver is at the restaurant, and
-- the same gate covers it).
do $$
declare
  v_token text;
  v_row   record;
begin
  update public.orders set status = 'preparing', delivered_at = null
   where id = '73000000-0000-0000-0000-000000000001';
  select token into v_token from public.order_shares
   where order_id = '73000000-0000-0000-0000-000000000001';

  set local role anon;
  select * into v_row from public.get_shared_order(v_token);
  if v_row.driver_lat is not null then
    raise exception 'no driver dot before pickup';
  end if;
  if v_row.status is distinct from 'preparing' then
    raise exception 'status should still be reported, got %', coalesce(v_row.status, 'null');
  end if;
  reset role;
end;
$$;

-- Expiry: past the grace window the link stops answering altogether.
do $$
declare
  v_token text;
  v_n     int;
begin
  update public.orders
     set status = 'delivered', delivered_at = now() - interval '3 hours'
   where id = '73000000-0000-0000-0000-000000000001';
  select token into v_token from public.order_shares
   where order_id = '73000000-0000-0000-0000-000000000001';

  set local role anon;
  select count(*) into v_n from public.get_shared_order(v_token);
  if v_n <> 0 then
    raise exception 'an expired link should return nothing, got % rows', v_n;
  end if;
  reset role;

  update public.orders
     set status = 'out_for_delivery', delivered_at = null
   where id = '73000000-0000-0000-0000-000000000001';
end;
$$;

-- Unknown / empty / null tokens reveal nothing and do not error.
do $$
declare
  v_n int;
begin
  set local role anon;
  select count(*) into v_n from public.get_shared_order('deadbeefdeadbeefdeadbeefdeadbeef');
  if v_n <> 0 then raise exception 'an unknown token must return nothing'; end if;
  select count(*) into v_n from public.get_shared_order('');
  if v_n <> 0 then raise exception 'an empty token must return nothing'; end if;
  select count(*) into v_n from public.get_shared_order(null);
  if v_n <> 0 then raise exception 'a null token must return nothing'; end if;
  reset role;
end;
$$;

-- ---------------------------------------------------------------------------
-- Revocation kills the link, and re-sharing mints a DIFFERENT token so the
-- revoked one stays dead.
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claim.sub', '70000000-0000-0000-0000-000000000001', true);
set local role authenticated;
do $$
declare
  v_old text;
  v_new text;
  v_n   int;
begin
  select token into v_old from public.order_shares
   where order_id = '73000000-0000-0000-0000-000000000001';

  perform public.revoke_order_share('73000000-0000-0000-0000-000000000001');
  -- Safe to tap twice.
  perform public.revoke_order_share('73000000-0000-0000-0000-000000000001');

  set local role anon;
  select count(*) into v_n from public.get_shared_order(v_old);
  if v_n <> 0 then
    raise exception 'a revoked link must stop answering, got % rows', v_n;
  end if;
  set local role authenticated;

  v_new := public.create_order_share('73000000-0000-0000-0000-000000000001');
  if v_new = v_old then
    raise exception 're-sharing after revoke must mint a NEW token';
  end if;

  set local role anon;
  select count(*) into v_n from public.get_shared_order(v_old);
  if v_n <> 0 then
    raise exception 'the old token must stay dead after re-sharing, got % rows', v_n;
  end if;
  select count(*) into v_n from public.get_shared_order(v_new);
  if v_n <> 1 then
    raise exception 'the new token should resolve, got % rows', v_n;
  end if;
  reset role;
end;
$$;

-- A stranger cannot revoke somebody else's share.
select set_config('request.jwt.claim.sub', '70000000-0000-0000-0000-000000000002', true);
set local role authenticated;
do $$
declare
  v_token text;
  v_n     int;
begin
  perform public.revoke_order_share('73000000-0000-0000-0000-000000000001');
  reset role;
  select token into v_token from public.order_shares
   where order_id = '73000000-0000-0000-0000-000000000001';
  set local role anon;
  select count(*) into v_n from public.get_shared_order(v_token);
  if v_n <> 1 then
    raise exception 'a stranger revoked a share they do not own';
  end if;
  reset role;
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants and authority shape.
-- ---------------------------------------------------------------------------
do $$
begin
  -- anon resolves links but can do nothing else.
  if not exists (
    select 1 from information_schema.role_routine_grants
     where routine_schema = 'public' and routine_name = 'get_shared_order'
       and grantee = 'anon' and privilege_type = 'EXECUTE'
  ) then
    raise exception 'anon must be able to resolve a share token';
  end if;

  for i in 1..1 loop
    if exists (
      select 1 from information_schema.role_routine_grants
       where routine_schema = 'public'
         and routine_name in ('create_order_share', 'revoke_order_share')
         and grantee in ('anon', 'PUBLIC')
    ) then
      raise exception 'anon/PUBLIC must not mint or revoke shares';
    end if;
  end loop;

  -- House rule 5b / TRUNCATE ignores RLS.
  if exists (
    select 1 from information_schema.role_table_grants
     where table_schema = 'public' and table_name = 'order_shares'
       and grantee in ('anon', 'PUBLIC')
  ) then
    raise exception 'anon must hold no grant at all on order_shares';
  end if;

  if exists (
    select 1 from information_schema.role_table_grants
     where table_schema = 'public' and table_name = 'order_shares'
       and grantee = 'authenticated'
       and privilege_type in ('INSERT','UPDATE','DELETE','TRUNCATE')
  ) then
    raise exception 'order_shares writes must go through the RPCs only';
  end if;

  -- House rule 1: one overload each, or PostgREST answers PGRST202.
  if (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = 'get_shared_order') <> 1
     or (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public' and p.proname = 'create_order_share') <> 1 then
    raise exception 'share functions must have exactly one overload each';
  end if;
end;
$$;

rollback;

\echo '186_order_share_links.test.sql: PASS'
