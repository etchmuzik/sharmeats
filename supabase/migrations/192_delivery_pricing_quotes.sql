-- 192_delivery_pricing_quotes.sql
--
-- Package 08 Slice B (dark): pricing versions, parcel policy, private quotes,
-- quote_delivery_job. Sharm stays disabled+closed — the RPC provably refuses
-- everyone until the owner opens the internal stage, and even then only
-- delivery_dispatch holders can quote (internal kind is the only v1 requester;
-- merchant/customer kinds arrive with their slices). Seeded amounts are the
-- owner's PROVISIONAL numbers (EXPANSION-OWNER-DECISIONS): representative,
-- replace before any real trading.

create table if not exists public.delivery_pricing_versions (
  id uuid primary key default gen_random_uuid(),
  service_area_id uuid not null references public.service_areas(id) on delete restrict,
  currency text not null default 'EGP' check (currency = 'EGP'),
  base_fee_egp int not null check (base_fee_egp between 0 and 1000),
  included_distance_m int not null default 0 check (included_distance_m between 0 and 20000),
  per_started_km_egp int not null check (per_started_km_egp between 0 and 200),
  distance_multiplier numeric(4,2) not null default 1.30 check (distance_multiplier between 1.0 and 2.0),
  driver_base_earning_egp int not null check (driver_base_earning_egp >= 0),
  driver_per_started_km_egp int not null default 0 check (driver_per_started_km_egp >= 0),
  min_fee_egp int not null check (min_fee_egp >= 0),
  max_fee_egp int not null check (max_fee_egp >= min_fee_egp),
  status text not null default 'draft' check (status in ('draft','active','retired')),
  approved_by uuid,
  active_from timestamptz,
  retired_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index if not exists delivery_pricing_one_active_per_area
  on public.delivery_pricing_versions (service_area_id) where status = 'active';

create table if not exists public.delivery_parcel_policy_versions (
  id uuid primary key default gen_random_uuid(),
  prohibited_goods_version text not null,
  terms_version text not null,
  status text not null default 'draft' check (status in ('draft','approved','retired')),
  approved_by uuid,
  approved_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.delivery_parcel_bands (
  policy_version_id uuid not null references public.delivery_parcel_policy_versions(id) on delete cascade,
  band_code text not null check (band_code ~ '^[a-z_]{2,20}$'),
  max_weight_kg numeric(5,2) not null check (max_weight_kg > 0),
  max_declared_value_egp int not null check (max_declared_value_egp > 0),
  primary key (policy_version_id, band_code)
);

create table if not exists public.delivery_parcel_categories (
  policy_version_id uuid not null references public.delivery_parcel_policy_versions(id) on delete cascade,
  category text not null check (category ~ '^[a-z_]{2,30}$'),
  is_allowed boolean not null,
  primary key (policy_version_id, category)
);

alter table public.delivery_pricing_versions enable row level security;
alter table public.delivery_parcel_policy_versions enable row level security;
alter table public.delivery_parcel_bands enable row level security;
alter table public.delivery_parcel_categories enable row level security;
revoke all on table public.delivery_pricing_versions from public, anon, authenticated;
revoke all on table public.delivery_parcel_policy_versions from public, anon, authenticated;
revoke all on table public.delivery_parcel_bands from public, anon, authenticated;
revoke all on table public.delivery_parcel_categories from public, anon, authenticated;
grant select, insert, update on table public.delivery_pricing_versions to service_role;
grant select, insert, update on table public.delivery_parcel_policy_versions to service_role;
grant select, insert, update on table public.delivery_parcel_bands to service_role;
grant select, insert, update on table public.delivery_parcel_categories to service_role;

-- Quotes: private schema, no client grants — access is RPC-only.
create table if not exists private.delivery_quotes (
  id uuid primary key default gen_random_uuid(),
  requester_kind text not null check (requester_kind in ('internal')),  -- v1: internal only; widened by later slices
  created_by_user_id uuid not null,
  idempotency_key text not null check (length(idempotency_key) between 8 and 80),
  pickup_point geography(point, 4326) not null,
  dropoff_point geography(point, 4326) not null,
  service_area_id uuid not null,
  straight_line_distance_m int not null,
  billable_distance_m int not null,
  parcel_category text not null,
  parcel_band_code text not null,
  package_count int not null check (package_count between 1 and 5),
  declared_value_egp int not null check (declared_value_egp >= 0),
  fragile boolean not null default false,
  prohibited_goods_version text not null,
  terms_version text not null,
  price_egp int not null,
  driver_earning_egp int not null,
  pricing_version_id uuid not null,
  parcel_policy_version_id uuid not null,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  unique (created_by_user_id, idempotency_key)
);

create or replace function public.quote_delivery_job(
  p_pickup_lat double precision,
  p_pickup_lng double precision,
  p_dropoff_lat double precision,
  p_dropoff_lng double precision,
  p_parcel_category text,
  p_parcel_band_code text,
  p_package_count int,
  p_declared_value_egp int,
  p_fragile boolean,
  p_idempotency_key text
)
returns table (quote_id uuid, price_egp int, billable_distance_m int, expires_at timestamptz)
language plpgsql
security definer set search_path = public, pg_temp
as $$
declare
  v_pickup geography; v_dropoff geography;
  v_sa uuid; v_cfg public.delivery_service_configs;
  v_pricing public.delivery_pricing_versions;
  v_band public.delivery_parcel_bands;
  v_policy public.delivery_parcel_policy_versions;
  v_dist int; v_billable int; v_price int; v_earn int; v_id uuid; v_exp timestamptz;
begin
  -- v1 dark contract: internal requesters only, capability-gated.
  if auth.uid() is null or not public.i_have_platform_capability('delivery_dispatch') then
    raise exception 'NOT_AUTHORIZED' using errcode = 'check_violation';
  end if;

  -- Finite, in-range coordinates or nothing. NaN/inf fail the between checks.
  if p_pickup_lat is null or p_pickup_lng is null or p_dropoff_lat is null or p_dropoff_lng is null
     or p_pickup_lat not between -90 and 90 or p_dropoff_lat not between -90 and 90
     or p_pickup_lng not between -180 and 180 or p_dropoff_lng not between -180 and 180 then
    raise exception 'INVALID_COORDINATES' using errcode = 'check_violation';
  end if;
  v_pickup := st_setsrid(st_makepoint(p_pickup_lng, p_pickup_lat), 4326)::geography;
  v_dropoff := st_setsrid(st_makepoint(p_dropoff_lng, p_dropoff_lat), 4326)::geography;

  -- Both endpoints in the SAME active service area — fail closed on either.
  v_sa := public.resolve_service_area(v_pickup);
  if v_sa is null or v_sa is distinct from public.resolve_service_area(v_dropoff) then
    raise exception 'OUT_OF_SERVICE_AREA' using errcode = 'check_violation';
  end if;

  select * into v_cfg from public.delivery_service_configs where service_area_id = v_sa;
  if v_cfg.service_area_id is null
     or v_cfg.launch_stage = 'disabled'
     or v_cfg.intake_state <> 'open' then
    raise exception 'DELIVERY_NOT_AVAILABLE' using errcode = 'check_violation';
  end if;

  select * into v_pricing from public.delivery_pricing_versions
   where id = v_cfg.pricing_version_id and status = 'active';
  select * into v_policy from public.delivery_parcel_policy_versions
   where id = v_cfg.parcel_policy_version_id and status = 'approved';
  if v_pricing.id is null or v_policy.id is null then
    raise exception 'DELIVERY_NOT_CONFIGURED' using errcode = 'check_violation';
  end if;

  -- Category must be explicitly allowed; band must exist; value inside band.
  if not exists (select 1 from public.delivery_parcel_categories
                  where policy_version_id = v_policy.id and category = p_parcel_category and is_allowed) then
    raise exception 'PARCEL_CATEGORY_NOT_ALLOWED' using errcode = 'check_violation';
  end if;
  select * into v_band from public.delivery_parcel_bands
   where policy_version_id = v_policy.id and band_code = p_parcel_band_code;
  if v_band.policy_version_id is null then
    raise exception 'PARCEL_BAND_UNKNOWN' using errcode = 'check_violation';
  end if;
  if p_declared_value_egp is null or p_declared_value_egp < 0
     or p_declared_value_egp > v_band.max_declared_value_egp then
    raise exception 'DECLARED_VALUE_OUT_OF_BAND' using errcode = 'check_violation';
  end if;
  if p_package_count is null or p_package_count <> 1 then
    -- v1 contract: one sealed parcel.
    raise exception 'ONE_PARCEL_ONLY' using errcode = 'check_violation';
  end if;

  -- Conservative estimated route: straight line x multiplier, per STARTED km
  -- beyond the included distance. Server math only; nothing client-supplied.
  v_dist := round(st_distance(v_pickup, v_dropoff))::int;
  v_billable := ceil(v_dist * v_pricing.distance_multiplier)::int;
  v_price := v_pricing.base_fee_egp
           + v_pricing.per_started_km_egp
             * ceil(greatest(0, v_billable - v_pricing.included_distance_m) / 1000.0)::int;
  v_price := least(greatest(v_price, v_pricing.min_fee_egp), v_pricing.max_fee_egp);
  v_earn := v_pricing.driver_base_earning_egp
          + v_pricing.driver_per_started_km_egp
            * ceil(greatest(0, v_billable - v_pricing.included_distance_m) / 1000.0)::int;
  v_exp := clock_timestamp() + make_interval(secs => v_cfg.quote_ttl_seconds);

  insert into private.delivery_quotes
    (requester_kind, created_by_user_id, idempotency_key, pickup_point, dropoff_point,
     service_area_id, straight_line_distance_m, billable_distance_m,
     parcel_category, parcel_band_code, package_count, declared_value_egp, fragile,
     prohibited_goods_version, terms_version, price_egp, driver_earning_egp,
     pricing_version_id, parcel_policy_version_id, expires_at)
  values
    ('internal', auth.uid(), p_idempotency_key, v_pickup, v_dropoff,
     v_sa, v_dist, v_billable,
     p_parcel_category, p_parcel_band_code, 1, p_declared_value_egp, coalesce(p_fragile, false),
     v_policy.prohibited_goods_version, v_policy.terms_version, v_price, v_earn,
     v_pricing.id, v_policy.id, v_exp)
  on conflict (created_by_user_id, idempotency_key) do nothing;

  -- Idempotent replay returns the original quote unchanged.
  select q.id, q.price_egp, q.billable_distance_m, q.expires_at
    into v_id, v_price, v_billable, v_exp
    from private.delivery_quotes q
   where q.created_by_user_id = auth.uid() and q.idempotency_key = p_idempotency_key;

  return query select v_id, v_price, v_billable, v_exp;
end;
$$;
revoke all on function public.quote_delivery_job(double precision, double precision, double precision, double precision, text, text, int, int, boolean, text)
  from public, anon, authenticated;
grant execute on function public.quote_delivery_job(double precision, double precision, double precision, double precision, text, text, int, int, boolean, text)
  to authenticated;

comment on function public.quote_delivery_job(double precision, double precision, double precision, double precision, text, text, int, int, boolean, text) is
  'Package 08 Slice B (dark): delivery_dispatch capability only in v1; fails closed on coordinates, service area (both endpoints, same area), disabled stage, non-open intake, missing pricing/policy, disallowed category, unknown band, out-of-band value, package_count<>1. Straight-line x multiplier estimate, per-started-km beyond included distance, min/max clamped. Idempotent per (caller, key). Creates no job or driver obligation. Mig 192.';

-- ---------------------------------------------------------------------------
-- Seed: provisional pricing + policy (representative, replace before trading),
-- linked into the (still disabled+closed) Sharm config.
-- ---------------------------------------------------------------------------
do $mig$
declare v_sa uuid; v_pricing uuid; v_policy uuid;
begin
  select sa.id into v_sa from public.service_areas sa where sa.slug = 'sharm-core';
  if v_sa is null then return; end if;
  if exists (select 1 from public.delivery_pricing_versions where service_area_id = v_sa) then return; end if;

  insert into public.delivery_pricing_versions
    (service_area_id, base_fee_egp, included_distance_m, per_started_km_egp,
     distance_multiplier, driver_base_earning_egp, driver_per_started_km_egp,
     min_fee_egp, max_fee_egp, status, active_from)
  values (v_sa, 30, 2000, 8, 1.30, 25, 6, 30, 300, 'active', now())
  returning id into v_pricing;

  insert into public.delivery_parcel_policy_versions
    (prohibited_goods_version, terms_version, status, approved_at)
  values ('prohibited-v1-provisional', 'delivery-terms-v1-provisional', 'approved', now())
  returning id into v_policy;

  insert into public.delivery_parcel_bands (policy_version_id, band_code, max_weight_kg, max_declared_value_egp)
  values (v_policy, 'small', 3.00, 5000), (v_policy, 'large', 10.00, 5000);

  insert into public.delivery_parcel_categories (policy_version_id, category, is_allowed)
  values (v_policy, 'documents', true), (v_policy, 'clothing', true),
         (v_policy, 'electronics', true), (v_policy, 'food_sealed', true),
         (v_policy, 'household', true), (v_policy, 'other_allowed', true),
         (v_policy, 'cash', false), (v_policy, 'medicine', false),
         (v_policy, 'weapons', false), (v_policy, 'flammable', false);

  update public.delivery_service_configs
     set pricing_version_id = v_pricing, parcel_policy_version_id = v_policy
   where service_area_id = v_sa;
end;
$mig$;
