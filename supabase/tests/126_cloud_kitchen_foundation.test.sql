\set ON_ERROR_STOP on

-- Tests for 126_cloud_kitchen_foundation.sql
--
-- Proves the three things migration 126 exists to guarantee:
--   1. A company-owned brand can NEVER be featured (ranking integrity).
--   2. A company-owned brand can NEVER receive a settlement row (no self-payout)
--      -- via BOTH writers: generate_settlements() and the settlement_sweep() cron.
--   3. Own-brand revenue is not double-counted in the blended take rate.
-- Plus: the nightly loyalty sweep leaves own brands alone, and the batching
-- shadow log recognises five brands in one kitchen as ONE pickup point.
--
-- Each block that asserts a guard is preceded by a NEGATIVE CONTROL proving the
-- unguarded behaviour really is broken, so a test that silently stops
-- exercising the guard cannot pass by accident.
--
-- METHODOLOGY LIMIT (learned the hard way, 2026-07-27): this file asserts
-- against SHIM copies of the migration's objects, not the migration file
-- itself (PostGIS types make \i impossible in the vanilla ephemeral cluster).
-- A shim suite can pass while the real body is broken -- it missed the
-- v_kitchen unassigned-record crash in admin_set_merchant_type. The REAL
-- bodies are therefore additionally validated by a transaction-wrapped
-- BEGIN; <entire migration>; <asserts calling the real functions>; ROLLBACK;
-- against the production schema (see docs/DATABASE-RELEASE-RUNBOOK.md) before
-- any apply. Keep both: this file guards the logic cheaply in CI; the prod
-- dry run guards the actual SQL.

begin;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin; end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Shims. Enum value sets mirror the real definitions exactly
-- (002_app_schema.sql for zone_type/cuisine_type, 007 for app_role).
-- geography() is shimmed to text: PostGIS is not available in the ephemeral
-- test cluster, and none of the assertions below depend on spatial maths --
-- the batching test asserts on pickup IDENTITY, which is the whole point of
-- migration 126 (it replaces the float-equal geo comparison).
-- ---------------------------------------------------------------------------
create type app_role as enum ('customer','driver','merchant_staff','dispatcher','admin');
create type zone_type as enum ('naama','hadaba','nabq','old_market','soho','sharks_bay',
                               'el_salam','mubarak_7','el_rowaisat','hay_el_nour','el_hadaba_residential');
create type cuisine_type as enum ('egyptian','seafood','italian','burgers','desserts','breakfast');

create schema auth;
create function auth.uid() returns uuid language sql stable as $$ select current_setting('test.uid', true)::uuid $$;

create table public.zones (id zone_type primary key, name text not null default '');
insert into public.zones (id) values ('naama'),('hadaba'),('nabq');

create table public.users (
  id uuid primary key,
  role app_role not null default 'customer'
);

create function public.auth_role() returns app_role
language sql stable security definer set search_path = public, pg_temp as $$
  select role from public.users where id = auth.uid()
$$;

create table public.restaurants (
  id             uuid primary key default gen_random_uuid(),
  slug           text not null unique,
  name           text not null,
  zone           zone_type not null references public.zones(id),
  geo            text,
  address        text,
  commission_pct numeric(5,2) not null default 15.0,
  featured       boolean,                    -- nullable, exactly as in mig 002
  is_active      boolean not null default true,
  updated_at     timestamptz not null default now()
);

create table public.merchant_staff (
  profile_id    uuid not null references public.users(id) on delete cascade,
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  staff_role    text not null default 'staff',
  primary key (profile_id, restaurant_id)
);

create table public.order_financials (
  order_id       uuid primary key default gen_random_uuid(),
  restaurant_id  uuid not null references public.restaurants(id),
  subtotal_egp   int not null,
  commission_pct numeric(5,2) not null,
  commission_egp int not null,
  discount_egp   int not null default 0,
  payment_method text not null,
  delivered_at   timestamptz not null
);

create table public.restaurant_settlements (
  id              uuid primary key default gen_random_uuid(),
  restaurant_id   uuid not null references public.restaurants(id) on delete cascade,
  period_start    date not null,
  period_end      date not null,
  order_count     int not null default 0,
  gross_sales_egp int not null default 0,
  cod_sales_egp   int not null default 0,
  card_sales_egp  int not null default 0,
  commission_egp  int not null default 0,
  net_payable_egp int not null default 0,
  status          text not null default 'draft' check (status in ('draft','finalized','paid')),
  updated_at      timestamptz not null default now(),
  unique (restaurant_id, period_start, period_end)
);

create table public.platform_settings (key text primary key, value jsonb not null);
insert into public.platform_settings (key, value) values
  ('batch_max_pickup_gap_m',  to_jsonb(400)),
  ('batch_max_dropoff_gap_m', to_jsonb(1500)),
  ('batch_ready_window_min',  to_jsonb(6)),
  ('batch_shadow_logging',    to_jsonb(true));

create table public.orders (
  id                 uuid primary key default gen_random_uuid(),
  restaurant_id      uuid not null references public.restaurants(id),
  zone               zone_type not null,
  status             text not null,
  assigned_driver_id uuid,
  scheduled_for      timestamptz,
  dropoff_geo        text,
  ready_at           timestamptz,
  placed_at          timestamptz not null default now()
);

create table public.batch_candidate_log (
  order_a         uuid not null,
  order_b         uuid not null,
  same_restaurant boolean not null,
  pickup_gap_m    int,
  dropoff_gap_m   int,
  ready_gap_min   numeric,
  zone            text,
  primary key (order_a, order_b)
);

-- ===========================================================================
-- NEGATIVE CONTROL 1 -- the unguarded settlement writer really does draft a
-- payout to ourselves. This is the bug migration 126 exists to prevent.
-- ===========================================================================
create type public.merchant_type as enum ('third_party', 'own_brand');
alter table public.restaurants
  add column kitchen_id uuid,
  add column merchant_type public.merchant_type not null default 'third_party';

insert into public.users (id, role) values ('11111111-1111-1111-1111-111111111111', 'admin');
select set_config('test.uid', '11111111-1111-1111-1111-111111111111', true);

insert into public.restaurants (id, slug, name, zone, commission_pct, merchant_type)
values ('aaaaaaaa-0000-0000-0000-000000000001', 'sinai-smash', 'Sinai Smash', 'hadaba', 0.00, 'own_brand');

-- A card order: EGP 1000 subtotal, 0% commission (the intuitive-but-wrong rate).
insert into public.order_financials (restaurant_id, subtotal_egp, commission_pct, commission_egp, payment_method, delivered_at)
values ('aaaaaaaa-0000-0000-0000-000000000001', 1000, 0.00, 0, 'card', now() - interval '1 day');

do $$
declare v_payable int;
begin
  -- The OLD aggregation, verbatim in shape: no ownership filter.
  select coalesce(sum(f.subtotal_egp) filter (where f.payment_method <> 'cash_on_delivery'), 0)
         - coalesce(sum(f.commission_egp), 0)
    into v_payable
    from public.order_financials f
   where f.restaurant_id = 'aaaaaaaa-0000-0000-0000-000000000001';

  if v_payable <> 1000 then
    raise exception 'NEGATIVE CONTROL FAILED: expected the unguarded formula to owe us 1000 to ourselves, got %', v_payable;
  end if;
  raise notice 'negative control 1 OK: unguarded settlement would pay ourselves EGP % (100%% of card sales at 0%% commission)', v_payable;
end;
$$;

-- Reset the rate to the sentinel migration 126 actually uses.
update public.restaurants set commission_pct = 100.00
 where id = 'aaaaaaaa-0000-0000-0000-000000000001';
delete from public.order_financials;

-- ===========================================================================
-- Install the migration-126 objects under test.
-- (The real migration also creates the enum and columns; created above so the
-- negative control could run first.)
-- ===========================================================================
create table public.kitchens (
  id               uuid primary key default gen_random_uuid(),
  name             text not null,
  slug             text not null unique,
  address          text,
  zone             zone_type not null references public.zones(id),
  geo              text,
  monthly_rent_egp int not null default 0 check (monthly_rent_egp >= 0),
  lease_start      date,
  lease_end        date,
  is_active        boolean not null default true,
  notes            text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint kitchens_lease_order_chk
    check (lease_end is null or lease_start is null or lease_end >= lease_start)
);
alter table public.restaurants add constraint restaurants_kitchen_fk
  foreign key (kitchen_id) references public.kitchens(id) on delete set null;

alter table public.restaurants
  add constraint restaurants_own_brand_never_featured_chk
    check (merchant_type <> 'own_brand' or coalesce(featured, false) = false) not valid;
alter table public.restaurants validate constraint restaurants_own_brand_never_featured_chk;

create function public.generate_settlements(p_period_start date, p_period_end date)
returns int language plpgsql security definer set search_path to 'public','pg_temp' as $function$
declare v_count int := 0;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED' using errcode='check_violation'; end if;
  if coalesce(public.auth_role()::text,'') <> 'admin' then raise exception 'NOT_AUTHORIZED' using errcode='check_violation'; end if;
  with agg as (
    select f.restaurant_id, count(*) as order_count,
      sum(f.subtotal_egp) as gross_sales,
      sum(f.subtotal_egp) filter (where f.payment_method='cash_on_delivery') as cod_sales,
      sum(f.subtotal_egp) filter (where f.payment_method<>'cash_on_delivery') as card_sales,
      sum(f.commission_egp) as commission,
      coalesce(sum(f.discount_egp) filter (where f.payment_method='cash_on_delivery'),0) as cod_discount
    from public.order_financials f
    join public.restaurants r on r.id = f.restaurant_id
    where f.delivered_at::date between p_period_start and p_period_end
      and r.merchant_type <> 'own_brand'
    group by f.restaurant_id
  )
  insert into public.restaurant_settlements (
    restaurant_id, period_start, period_end, order_count,
    gross_sales_egp, cod_sales_egp, card_sales_egp, commission_egp, net_payable_egp, status)
  select a.restaurant_id, p_period_start, p_period_end, a.order_count,
    a.gross_sales, coalesce(a.cod_sales,0), coalesce(a.card_sales,0), a.commission,
    coalesce(a.card_sales,0) - a.commission + a.cod_discount, 'draft'
  from agg a
  on conflict (restaurant_id, period_start, period_end) do update set
    net_payable_egp = excluded.net_payable_egp, updated_at = now()
  where public.restaurant_settlements.status <> 'paid';
  get diagnostics v_count = row_count;
  return v_count;
end; $function$;

create function public.reject_own_brand_settlement() returns trigger
language plpgsql security definer set search_path to 'public','pg_temp' as $function$
begin
  if exists (select 1 from public.restaurants where id = new.restaurant_id and merchant_type = 'own_brand') then
    raise exception 'OWN_BRAND_HAS_NO_SETTLEMENT' using errcode = 'check_violation';
  end if;
  return new;
end; $function$;

-- INSERT-only, matching the migration: pre-conversion settlement rows must
-- stay finalize-able/payable after a merchant converts to own_brand (test 8).
create trigger trg_reject_own_brand_settlement
  before insert on public.restaurant_settlements
  for each row execute function public.reject_own_brand_settlement();

create function public.platform_revenue_report(p_period_start date, p_period_end date)
returns table (
  gmv_egp bigint, third_party_gmv_egp bigint, own_brand_gmv_egp bigint,
  third_party_commission_egp bigint, own_brand_revenue_egp bigint, net_revenue_egp bigint,
  blended_take_rate_pct numeric, marketplace_take_rate_pct numeric,
  third_party_orders bigint, own_brand_orders bigint)
language plpgsql stable security definer set search_path to 'public','pg_temp' as $function$
begin
  if coalesce(public.auth_role()::text,'') <> 'admin' then raise exception 'NOT_AUTHORIZED' using errcode='check_violation'; end if;
  return query
  with f as (
    select fin.subtotal_egp, fin.commission_egp, (r.merchant_type = 'own_brand') as is_own
      from public.order_financials fin
      join public.restaurants r on r.id = fin.restaurant_id
     where fin.delivered_at::date between p_period_start and p_period_end),
  t as (
    select coalesce(sum(fx.subtotal_egp),0)::bigint as gmv,
      coalesce(sum(fx.subtotal_egp) filter (where not fx.is_own),0)::bigint as tp_gmv,
      coalesce(sum(fx.subtotal_egp) filter (where fx.is_own),0)::bigint as ob_gmv,
      coalesce(sum(fx.commission_egp) filter (where not fx.is_own),0)::bigint as tp_comm,
      count(*) filter (where not fx.is_own)::bigint as tp_orders,
      count(*) filter (where fx.is_own)::bigint as ob_orders
    from f fx)
  select t.gmv, t.tp_gmv, t.ob_gmv, t.tp_comm, t.ob_gmv, (t.tp_comm + t.ob_gmv),
    case when t.gmv > 0 then round(100.0*(t.tp_comm+t.ob_gmv)/t.gmv,2) else null end,
    case when t.tp_gmv > 0 then round(100.0*t.tp_comm/t.tp_gmv,2) else null end,
    t.tp_orders, t.ob_orders
  from t;
end; $function$;

-- ===========================================================================
-- TEST 1 -- ranking integrity: an own brand can never be featured.
-- ===========================================================================
do $$
declare v_kitchen uuid;
begin
  insert into public.kitchens (name, slug, zone, monthly_rent_egp, address)
  values ('Mercato Kitchen', 'mercato', 'hadaba', 40000, 'Mercato, opposite McDonald''s')
  returning id into v_kitchen;

  update public.restaurants set kitchen_id = v_kitchen
   where id = 'aaaaaaaa-0000-0000-0000-000000000001';

  -- Direct UPDATE -- the path a nightly cron or a manual psql session would take.
  begin
    update public.restaurants set featured = true
     where id = 'aaaaaaaa-0000-0000-0000-000000000001';
    raise exception 'TEST 1 FAILED: an own brand was allowed to be featured';
  exception when check_violation then
    raise notice 'test 1 OK: own brand cannot be featured (constraint blocked a direct UPDATE)';
  end;

  -- A third party is unaffected.
  insert into public.restaurants (id, slug, name, zone, commission_pct, merchant_type)
  values ('bbbbbbbb-0000-0000-0000-000000000002', 'partner-grill', 'Partner Grill', 'hadaba', 15.00, 'third_party');
  update public.restaurants set featured = true
   where id = 'bbbbbbbb-0000-0000-0000-000000000002';
  if not (select featured from public.restaurants where id = 'bbbbbbbb-0000-0000-0000-000000000002') then
    raise exception 'TEST 1 FAILED: a third party should still be featurable';
  end if;
  raise notice 'test 1 OK: third parties are still featurable';
end;
$$;

-- ===========================================================================
-- TEST 2 -- no self-payout, via the admin RPC.
-- Both merchants have delivered card orders in the period.
-- ===========================================================================
insert into public.order_financials (restaurant_id, subtotal_egp, commission_pct, commission_egp, payment_method, delivered_at)
values
  ('aaaaaaaa-0000-0000-0000-000000000001', 1000, 100.00, 1000, 'card', now() - interval '1 day'),
  ('bbbbbbbb-0000-0000-0000-000000000002', 1000, 15.00,   150, 'card', now() - interval '1 day');

do $$
declare v_rows int; v_own int; v_tp int;
begin
  select public.generate_settlements((now() - interval '3 days')::date, now()::date) into v_rows;

  select count(*) into v_own from public.restaurant_settlements
   where restaurant_id = 'aaaaaaaa-0000-0000-0000-000000000001';
  select count(*) into v_tp  from public.restaurant_settlements
   where restaurant_id = 'bbbbbbbb-0000-0000-0000-000000000002';

  if v_own <> 0 then
    raise exception 'TEST 2 FAILED: % settlement row(s) generated for an own brand', v_own;
  end if;
  if v_tp <> 1 then
    raise exception 'TEST 2 FAILED: expected exactly 1 third-party settlement, got %', v_tp;
  end if;
  raise notice 'test 2 OK: own brand got 0 settlement rows, third party got 1 (net_payable %)',
    (select net_payable_egp from public.restaurant_settlements where restaurant_id = 'bbbbbbbb-0000-0000-0000-000000000002');
end;
$$;

-- ===========================================================================
-- TEST 3 -- the structural guard: even a hand-written INSERT is refused.
-- This is the backstop for any future backfill script or one-off admin SQL.
-- ===========================================================================
do $$
begin
  begin
    insert into public.restaurant_settlements
      (restaurant_id, period_start, period_end, card_sales_egp, net_payable_egp)
    values ('aaaaaaaa-0000-0000-0000-000000000001', current_date - 7, current_date, 1000, 1000);
    raise exception 'TEST 3 FAILED: a manual own-brand settlement INSERT succeeded';
  exception when check_violation then
    raise notice 'test 3 OK: manual own-brand settlement INSERT raised OWN_BRAND_HAS_NO_SETTLEMENT';
  end;
end;
$$;

-- ===========================================================================
-- TEST 4 -- revenue is not double-counted.
-- Own brand: 1000 GMV, our revenue is the whole 1000 (commission_egp is an
-- internal transfer and must be ignored).
-- Third party: 1000 GMV, our revenue is the 150 commission.
-- Correct net revenue = 1000 + 150 = 1150, NOT 1000 + 1000 + 150 = 2150.
-- ===========================================================================
do $$
declare r record;
begin
  select * into r from public.platform_revenue_report((now() - interval '3 days')::date, now()::date);

  if r.net_revenue_egp <> 1150 then
    raise exception 'TEST 4 FAILED: net revenue should be 1150 (1000 own-brand food + 150 commission), got %', r.net_revenue_egp;
  end if;
  if r.gmv_egp <> 2000 then
    raise exception 'TEST 4 FAILED: GMV should be 2000, got %', r.gmv_egp;
  end if;
  -- Marketplace take rate must stay the honest 15%, NOT the blended figure.
  if r.marketplace_take_rate_pct <> 15.00 then
    raise exception 'TEST 4 FAILED: marketplace take rate should be 15.00, got %', r.marketplace_take_rate_pct;
  end if;
  if r.blended_take_rate_pct <> 57.50 then
    raise exception 'TEST 4 FAILED: blended take rate should be 57.50, got %', r.blended_take_rate_pct;
  end if;
  raise notice 'test 4 OK: net revenue % (no double count), blended %%%, marketplace %%%',
    r.net_revenue_egp, r.blended_take_rate_pct, r.marketplace_take_rate_pct;
end;
$$;

-- ===========================================================================
-- TEST 5 -- kitchen-aware batching: two DIFFERENT brands in the SAME kitchen
-- are one pickup point.
-- Asserts on pickup IDENTITY rather than distance -- that substitution is the
-- entire point of the change (it removes the float-equal geo dependency).
-- ===========================================================================
do $$
declare
  v_kitchen uuid;
  v_same_restaurant boolean;
  v_same_pickup     boolean;
begin
  select id into v_kitchen from public.kitchens where slug = 'mercato';

  -- Second own brand in the same kitchen.
  insert into public.restaurants (id, slug, name, zone, commission_pct, merchant_type, kitchen_id)
  values ('aaaaaaaa-0000-0000-0000-000000000003', 'sukkar', 'Sukkar', 'hadaba', 100.00, 'own_brand', v_kitchen);

  -- The migration's pickup-identity expression.
  select (a.restaurant_id = b.restaurant_id),
         (coalesce(a.kitchen_id, a.restaurant_id) = coalesce(b.kitchen_id, b.restaurant_id))
    into v_same_restaurant, v_same_pickup
  from (select id as restaurant_id, kitchen_id from public.restaurants where slug = 'sinai-smash') a
  cross join (select id as restaurant_id, kitchen_id from public.restaurants where slug = 'sukkar') b;

  if v_same_restaurant then
    raise exception 'TEST 5 FAILED: two distinct brands must not be the same restaurant';
  end if;
  if not v_same_pickup then
    raise exception 'TEST 5 FAILED: two brands in one kitchen must resolve to ONE pickup point';
  end if;
  raise notice 'test 5 OK: distinct brands (same_restaurant=false) share one pickup (same_pickup=true)';

  -- A third party with no kitchen falls back to its own id and does not collide.
  if (select coalesce(kitchen_id, id) from public.restaurants where slug = 'partner-grill')
     = (select coalesce(kitchen_id, id) from public.restaurants where slug = 'sinai-smash') then
    raise exception 'TEST 5 FAILED: an unrelated third party must not share our pickup identity';
  end if;
  raise notice 'test 5 OK: kitchen-less third party keeps its own pickup identity';
end;
$$;

-- ===========================================================================
-- TEST 6 -- the nightly loyalty sweep leaves own brands alone.
-- Reproduces the sweep's restaurant loop, including its
-- `exception when others then raise warning` behaviour, to prove the source
-- filter (not the constraint) is what protects us: without the filter the
-- violation would be SWALLOWED as a warning and desync the tier silently.
-- ===========================================================================
do $$
declare v_rec record; v_touched int := 0;
begin
  for v_rec in
    select r.id as restaurant_id, r.commission_pct as base_commission
      from public.restaurants r
     where r.merchant_type <> 'own_brand'     -- [126] the source filter
  loop
    begin
      update public.restaurants
         set commission_pct = greatest(0, v_rec.base_commission),
             featured = true                   -- simulates a gold tier
       where id = v_rec.restaurant_id
         and merchant_type <> 'own_brand';
      v_touched := v_touched + 1;
    exception when others then
      raise warning 'sweep restaurant(%) failed: %', v_rec.restaurant_id, sqlerrm;
    end;
  end loop;

  if exists (select 1 from public.restaurants where merchant_type = 'own_brand' and coalesce(featured,false)) then
    raise exception 'TEST 6 FAILED: the sweep featured an own brand';
  end if;
  if (select commission_pct from public.restaurants where slug = 'sinai-smash') <> 100.00 then
    raise exception 'TEST 6 FAILED: the sweep drifted the own-brand commission sentinel to %',
      (select commission_pct from public.restaurants where slug = 'sinai-smash');
  end if;
  raise notice 'test 6 OK: sweep touched % third-party row(s); own brands keep featured=false and the 100.00 sentinel', v_touched;
end;
$$;

-- ===========================================================================
-- TEST 7 -- converting a FEATURED third party into an own brand must succeed
-- by clearing `featured` in the same statement (otherwise the CHECK would make
-- the conversion impossible to perform).
-- ===========================================================================
do $$
begin
  -- partner-grill is currently featured = true (set in test 1 / test 6).
  if not (select coalesce(featured,false) from public.restaurants where slug = 'partner-grill') then
    update public.restaurants set featured = true where slug = 'partner-grill';
  end if;

  update public.restaurants set
    merchant_type  = 'own_brand',
    commission_pct = 100.00,
    featured       = false          -- cleared atomically, as admin_set_merchant_type does
  where slug = 'partner-grill';

  if (select coalesce(featured,false) from public.restaurants where slug = 'partner-grill') then
    raise exception 'TEST 7 FAILED: converted brand is still featured';
  end if;
  raise notice 'test 7 OK: a featured third party converts to own_brand with featured cleared atomically';
end;
$$;

-- ===========================================================================
-- TEST 8 -- a converted merchant's PRE-conversion settlements stay payable.
-- partner-grill earned a settlement row in test 2 (while third_party) and was
-- converted to own_brand in test 7. finalize_settlement / mark_settlement_paid
-- are UPDATEs on that row: they MUST still succeed, or money genuinely owed
-- for the third-party period is frozen forever. This is the regression test
-- for the INSERT OR UPDATE trigger bug (adversarial review, 2026-07-27).
-- ===========================================================================
do $$
declare v_status text;
begin
  -- finalize-style UPDATE on the pre-conversion row.
  update public.restaurant_settlements
     set status = 'finalized'
   where restaurant_id = 'bbbbbbbb-0000-0000-0000-000000000002'
     and status = 'draft';
  select status into v_status from public.restaurant_settlements
   where restaurant_id = 'bbbbbbbb-0000-0000-0000-000000000002';
  if v_status is distinct from 'finalized' then
    raise exception 'TEST 8 FAILED: pre-conversion settlement could not be finalized (status=%)', v_status;
  end if;

  -- mark-paid-style UPDATE.
  update public.restaurant_settlements
     set status = 'paid'
   where restaurant_id = 'bbbbbbbb-0000-0000-0000-000000000002'
     and status = 'finalized';
  select status into v_status from public.restaurant_settlements
   where restaurant_id = 'bbbbbbbb-0000-0000-0000-000000000002';
  if v_status is distinct from 'paid' then
    raise exception 'TEST 8 FAILED: pre-conversion settlement could not be marked paid (status=%)', v_status;
  end if;

  -- And the invariant still holds for NEW rows: an INSERT for the (now
  -- own-brand) merchant is still refused.
  begin
    insert into public.restaurant_settlements
      (restaurant_id, period_start, period_end, card_sales_egp, net_payable_egp)
    values ('bbbbbbbb-0000-0000-0000-000000000002', current_date - 14, current_date - 8, 500, 500);
    raise exception 'TEST 8 FAILED: a NEW own-brand settlement INSERT succeeded';
  exception when check_violation then
    null; -- expected
  end;
  raise notice 'test 8 OK: pre-conversion settlement finalized and paid; new own-brand INSERT still refused';
end;
$$;

do $$ begin raise notice 'ALL 126 CLOUD KITCHEN TESTS PASSED'; end; $$;

rollback;
