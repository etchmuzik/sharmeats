-- 043_loyalty_tiers.sql
-- Three-sided loyalty system, part 2: derived tier tables.
--
-- One row per subject per side, recomputed by the nightly sweep (migration
-- 044) from loyalty_points_ledger (customer) or directly from orders/drivers
-- (driver/restaurant — see 044 for why those two don't strictly need the
-- ledger for tiering, only for audit/clawback symmetry).
--
-- Non-destructive: new tables only.

create table if not exists public.customer_loyalty (
  user_id             uuid primary key references public.users(id) on delete cascade,
  tier                text not null default 'bronze' check (tier in ('bronze','silver','gold')),
  points_balance      int  not null default 0,
  points_rolling_12mo int  not null default 0,
  updated_at          timestamptz not null default now()
);

create table if not exists public.driver_loyalty (
  driver_id                uuid primary key references public.drivers(id) on delete cascade,
  tier                     text not null default 'bronze' check (tier in ('bronze','silver','gold')),
  deliveries_rolling_90d   int  not null default 0,
  acceptance_rate_snapshot numeric(5,2) not null default 100.0,
  rating_snapshot          numeric(3,2) not null default 5.0,
  bonus_per_delivery_egp   int  not null default 0,
  first_look_seconds       int  not null default 0,
  updated_at               timestamptz not null default now()
);

create table if not exists public.restaurant_loyalty (
  restaurant_id           uuid primary key references public.restaurants(id) on delete cascade,
  tier                    text not null default 'bronze' check (tier in ('bronze','silver','gold')),
  orders_rolling_90d      int  not null default 0,
  commission_discount_pct numeric(5,2) not null default 0,
  updated_at              timestamptz not null default now()
);

alter table public.customer_loyalty   enable row level security;
alter table public.driver_loyalty     enable row level security;
alter table public.restaurant_loyalty enable row level security;

-- Customers read their own row directly (simple auth.uid() = user_id match).
create policy "customer_loyalty_read_own" on public.customer_loyalty
  for select using (user_id = auth.uid());

-- Drivers/restaurants: subject_id is drivers.id/restaurants.id, not auth.uid(),
-- so a cheap row policy can't express "my own row" without a join. Deliberately
-- NO client policy here — reads go through my_driver_tier()/my_restaurant_tier()
-- SECURITY DEFINER RPCs (migration 046), matching the promo_codes/referrals
-- precedent of "no direct table access, narrow RPC only."

comment on table public.customer_loyalty is
  'One row per customer: current tier + spendable/rolling point totals. Recomputed nightly by loyalty_tier_sweep(). Client-readable (own row only); all writes are server-side.';
comment on table public.driver_loyalty is
  'One row per driver: tier + derived perks (bonus_per_delivery_egp, first_look_seconds). No client policy — read via my_driver_tier() RPC only.';
comment on table public.restaurant_loyalty is
  'One row per restaurant: tier + commission_discount_pct (subtracted from restaurants.commission_pct by the sweep). No client policy — read via my_restaurant_tier() RPC only.';
