# Three-Sided Loyalty System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build one shared points-ledger loyalty system covering customers (points/tiers/redemption), drivers (tiered bonuses + first-look dispatch), and restaurants (volume tiers → commission discount + featured placement), per `docs/superpowers/specs/2026-07-01-three-sided-loyalty-design.md`.

**Architecture:** One append-only `loyalty_points_ledger` table drives all three sides. A nightly `pg_cron` sweep (mirroring `dispatch_sweep()` in `025_auto_dispatch.sql`) recomputes each side's rolling-window tier from the ledger into three thin derived tables (`customer_loyalty`, `driver_loyalty`, `restaurant_loyalty`). Earn/clawback happen via triggers on `orders.status` transitions (mirroring `026_referrals.sql`'s `reward_referrer_on_delivery` trigger). Customer redemption mints one-time `promo_codes` rows exactly like the referral reward path — zero new checkout plumbing. Driver bonuses land in the existing `driver_earnings.bonus` column. Restaurant tiers write into the existing `restaurants.commission_pct` and `restaurants.featured` columns.

**Tech Stack:** PostgreSQL/PL/pgSQL (Supabase), `pg_cron`, Expo/React Native (customer + driver apps), Next.js 15 App Router + Tailwind (merchant-web), Expo/React Native (restaurant app), Vitest.

## Global Constraints

- Every new table gets RLS enabled with **no permissive client write policies** — all writes go through `SECURITY DEFINER` functions or triggers. Read access is at most `select using (subject_id = auth.uid())`-style, matching `promo_codes`/`promo_redemptions`/`referrals`.
- Every `SECURITY DEFINER` function uses `security definer set search_path = public, pg_temp` (never bare `public`), `stable` for pure reads, and an explicit `grant execute on function ... to authenticated` (or `to postgres` for cron-only functions) — never rely on implicit grants.
- Every internal/trigger-only/cron-only function gets an explicit `revoke all on function ... from public, anon, authenticated` immediately after definition, with a one-line comment explaining why (defends against the Supabase advisor's "anon can execute SECURITY DEFINER" false positive).
- Trigger bodies that do bookkeeping (not the core order-status transition) are wrapped in `exception when others then return new;` so a bug in loyalty accrual never blocks order fulfillment. The cron sweep function instead uses `raise warning` + continues, so failures stay visible in logs (matches `auto_assign_order`'s per-order `exception` block vs `dispatch_sweep`'s per-tick loop).
- Any row mutation that could double-fire on concurrent updates takes a `for update` row lock first (matches `reward_referrer_on_delivery`'s pattern) to avoid double-crediting.
- All tunable numbers (points-per-EGP rate, tier thresholds, bonus amounts, first-look seconds, commission discounts) live in `platform_settings` as `jsonb`, read via `coalesce((value #>> '{}')::int, <default>)` — never hardcoded in function bodies.
- New promo codes minted by this feature use prefix `LOY-` (parallel to `REF-` for referrals) and must never collide with the reserved `SHARM-` referral-code namespace.
- Migration files start at `042_` — NOT `041_`. `041_dropoff_preference.sql` already exists (an in-progress, unrelated checkout feature) as of this plan's writing; verify the actual next-free number in `supabase/migrations/` before starting Task 1, since more migrations may have landed since. Each migration is idempotent (`if not exists` / `create or replace`) and non-destructive, matching every existing migration's header comment style.
- No changes to `nearest_drivers` distance scoring or core dispatch fairness — driver tier only affects a delay in the existing offer-creation path.
- No refund/dispute workflow is being built. Clawback hooks into any transition away from `delivered` (today, only via `cancelled`), since `orders.status` has no `refunded` state.
- Driver app has **no i18n** — new driver screens use hardcoded English strings, matching every existing driver screen. Merchant-web has **no i18n and no test infrastructure** — new merchant-web work must bootstrap Vitest as part of this plan. Customer app **has full i18n** (en/ar/ru/it/de, 5 locale files kept in lockstep) — new customer screens must add parallel keys to all 5.
- Restaurant app (`apps/restaurant`) is a 4th surface added on this branch (`feat/restaurant-app-and-auto-advance`, not yet merged) — the tier card belongs on both merchant-web and `apps/restaurant`.

---

## Part A — Database (migrations 042–047)

### Task 1: Ledger table + platform_settings config

**Files:**
- Create: `supabase/migrations/042_loyalty_ledger.sql`

**Interfaces:**
- Produces: table `public.loyalty_points_ledger(id uuid pk, subject_type text, subject_id uuid, delta_points int, reason text, ref_order_id uuid, created_at timestamptz)`. `subject_type in ('customer','driver','restaurant')`, `reason in ('order_earn','redeem','clawback','tier_bonus')`.
- Produces: `platform_settings` keys — `loyalty_points_per_egp` (10), `loyalty_tier_multiplier_silver` (125 = 1.25x in hundredths), `loyalty_tier_multiplier_gold` (150), `loyalty_customer_silver_threshold` (500), `loyalty_customer_gold_threshold` (2000), `loyalty_driver_silver_threshold` (60), `loyalty_driver_gold_threshold` (200), `loyalty_driver_min_acceptance_pct` (80), `loyalty_driver_min_rating` (450 = 4.5 in hundredths), `loyalty_driver_bonus_silver_egp` (5), `loyalty_driver_bonus_gold_egp` (10), `loyalty_driver_first_look_gold_seconds` (8), `loyalty_restaurant_silver_threshold` (50), `loyalty_restaurant_gold_threshold` (200), `loyalty_restaurant_silver_discount_pct` (100 = 1.0 in hundredths), `loyalty_restaurant_gold_discount_pct` (200).

- [ ] **Step 1: Write the migration file**

```sql
-- 042_loyalty_ledger.sql
-- Three-sided loyalty system, part 1: the shared points ledger + config.
--
-- One append-only ledger drives customer, driver, and restaurant loyalty.
-- Each subject_type earns points on order delivery (migration 042 adds the
-- triggers) and a nightly sweep (migration 043) recomputes tier from it.
-- Redemption/clawback are also just ledger rows (negative delta_points).
--
-- Security model: RLS enabled, read-only-own policy, ALL writes via
-- SECURITY DEFINER functions/triggers — same shape as promo_redemptions
-- and referrals (019/026). No client can insert/update/delete directly.
--
-- Non-destructive: new table + new platform_settings rows only.

-- ============================================================================
-- loyalty_points_ledger
-- ============================================================================
create table if not exists public.loyalty_points_ledger (
  id            uuid primary key default gen_random_uuid(),
  subject_type  text not null check (subject_type in ('customer','driver','restaurant')),
  subject_id    uuid not null,
  delta_points  int  not null,
  reason        text not null check (reason in ('order_earn','redeem','clawback','tier_bonus')),
  ref_order_id  uuid references public.orders(id) on delete set null,
  created_at    timestamptz not null default now()
);

create index if not exists loyalty_ledger_subject_idx
  on public.loyalty_points_ledger (subject_type, subject_id, created_at desc);
create index if not exists loyalty_ledger_ref_order_idx
  on public.loyalty_points_ledger (ref_order_id) where ref_order_id is not null;

alter table public.loyalty_points_ledger enable row level security;

-- A customer may read their own ledger rows (history screen). Drivers and
-- restaurants read via their own SECURITY DEFINER RPCs (migration 044) rather
-- than a direct policy, since subject_id there is drivers.id/restaurants.id,
-- not auth.uid() — a plain policy can't express that join cheaply per-row.
create policy "loyalty_ledger_customer_read_own" on public.loyalty_points_ledger
  for select using (subject_type = 'customer' and subject_id = auth.uid());

comment on table public.loyalty_points_ledger is
  'Append-only points ledger for all three loyalty programs (customer/driver/restaurant). Never mutated in place — reversals are negative-delta rows. All writes via SECURITY DEFINER triggers/functions; RLS blocks direct client writes.';

-- ============================================================================
-- Config (tunable without a deploy) — mirrors the referral system's pattern.
-- ============================================================================
insert into public.platform_settings (key, value) values
  ('loyalty_points_per_egp',               to_jsonb(10)),   -- 1 point per 10 EGP subtotal
  ('loyalty_tier_multiplier_silver',       to_jsonb(125)),  -- x1.25, stored as hundredths
  ('loyalty_tier_multiplier_gold',         to_jsonb(150)),  -- x1.50
  ('loyalty_customer_silver_threshold',    to_jsonb(500)),  -- rolling-12mo points
  ('loyalty_customer_gold_threshold',      to_jsonb(2000)),
  ('loyalty_driver_silver_threshold',      to_jsonb(60)),   -- rolling-90d deliveries
  ('loyalty_driver_gold_threshold',        to_jsonb(200)),
  ('loyalty_driver_min_acceptance_pct',    to_jsonb(80)),   -- quality gate
  ('loyalty_driver_min_rating',            to_jsonb(450)),  -- 4.50, stored as hundredths
  ('loyalty_driver_bonus_silver_egp',      to_jsonb(5)),    -- per-delivery bonus
  ('loyalty_driver_bonus_gold_egp',        to_jsonb(10)),
  ('loyalty_driver_first_look_gold_seconds', to_jsonb(8)),  -- Gold sees offer N sec early
  ('loyalty_restaurant_silver_threshold',  to_jsonb(50)),   -- rolling-90d delivered orders
  ('loyalty_restaurant_gold_threshold',    to_jsonb(200)),
  ('loyalty_restaurant_silver_discount_pct', to_jsonb(100)), -- -1.00pp off commission_pct
  ('loyalty_restaurant_gold_discount_pct',   to_jsonb(200))  -- -2.00pp off commission_pct
on conflict (key) do nothing;

-- Reserve the LOY- prefix for minted redemption codes, same guard as SHARM-
-- for referrals (026) — keeps validate_promo's code-resolution unambiguous.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'promo_codes_not_loyalty_prefix_chk') then
    alter table public.promo_codes
      add constraint promo_codes_not_loyalty_prefix_chk
      check (upper(code) not like 'LOY-%');
  end if;
end $$;
```

- [ ] **Step 2: Validate locally against shimmed Postgres**

Follow the project's local SQL validation approach (see memory
`sharmeats-local-sql-validation` — shimmed Homebrew Postgres, no Docker/prod
needed). Apply `042_loyalty_ledger.sql` against a scratch local database and
confirm: table exists, indexes exist, RLS is enabled, the check constraint
rejects `insert into promo_codes (code, ...) values ('LOY-TEST', ...)`.

```bash
psql "$LOCAL_TEST_DSN" -f supabase/migrations/042_loyalty_ledger.sql
psql "$LOCAL_TEST_DSN" -c "insert into promo_codes (code, kind, value) values ('LOY-TEST','fixed',10);"
```

Expected: the `insert` fails with a check constraint violation
(`promo_codes_not_loyalty_prefix_chk`).

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/042_loyalty_ledger.sql
git commit -m "feat(db): add loyalty_points_ledger + tunable loyalty config"
```

---

### Task 2: Tier tables (customer/driver/restaurant)

**Files:**
- Create: `supabase/migrations/043_loyalty_tiers.sql`

**Interfaces:**
- Consumes: `public.loyalty_points_ledger` (Task 1).
- Produces: tables `public.customer_loyalty(user_id pk, tier, points_balance, points_rolling_12mo, updated_at)`, `public.driver_loyalty(driver_id pk, tier, deliveries_rolling_90d, acceptance_rate_snapshot, rating_snapshot, bonus_per_delivery_egp, first_look_seconds, updated_at)`, `public.restaurant_loyalty(restaurant_id pk, tier, orders_rolling_90d, commission_discount_pct, updated_at)`.

- [ ] **Step 1: Write the migration file**

```sql
-- 043_loyalty_tiers.sql
-- Three-sided loyalty system, part 2: derived tier tables.
--
-- One row per subject per side, recomputed by the nightly sweep (migration
-- 043) from loyalty_points_ledger (customer) or directly from orders/drivers
-- (driver/restaurant — see 043 for why those two don't strictly need the
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
-- SECURITY DEFINER RPCs (migration 044), matching the promo_codes/referrals
-- precedent of "no direct table access, narrow RPC only."

comment on table public.customer_loyalty is
  'One row per customer: current tier + spendable/rolling point totals. Recomputed nightly by loyalty_tier_sweep(). Client-readable (own row only); all writes are server-side.';
comment on table public.driver_loyalty is
  'One row per driver: tier + derived perks (bonus_per_delivery_egp, first_look_seconds). No client policy — read via my_driver_tier() RPC only.';
comment on table public.restaurant_loyalty is
  'One row per restaurant: tier + commission_discount_pct (subtracted from restaurants.commission_pct by the sweep). No client policy — read via my_restaurant_tier() RPC only.';
```

- [ ] **Step 2: Validate locally**

```bash
psql "$LOCAL_TEST_DSN" -f supabase/migrations/043_loyalty_tiers.sql
psql "$LOCAL_TEST_DSN" -c "\d customer_loyalty" -c "\d driver_loyalty" -c "\d restaurant_loyalty"
```

Expected: all three tables exist with the columns above, `rowsecurity = t`.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/043_loyalty_tiers.sql
git commit -m "feat(db): add customer/driver/restaurant loyalty tier tables"
```

---

### Task 3: Earn + clawback triggers on orders.status

**Files:**
- Create: `supabase/migrations/044_loyalty_earn_clawback.sql`

**Interfaces:**
- Consumes: `public.loyalty_points_ledger` (Task 1), `public.customer_loyalty` (Task 2), `orders` columns `status, subtotal_egp, user_id, assigned_driver_id, restaurant_id, id`.
- Produces: trigger function `public.accrue_loyalty_on_delivery()` (AFTER UPDATE OF status ON orders), trigger function `public.clawback_loyalty_on_reversal()` (AFTER UPDATE OF status ON orders), triggers `orders_accrue_loyalty` and `orders_clawback_loyalty`.

- [ ] **Step 1: Write the migration file**

```sql
-- 044_loyalty_earn_clawback.sql
-- Three-sided loyalty system, part 3: earn on delivery, clawback on reversal.
--
-- Mirrors reward_referrer_on_delivery (026): an AFTER UPDATE OF status trigger
-- on orders reacts to the delivered transition. Unlike the referral reward
-- (a one-time mint), loyalty earn/clawback happen on EVERY order for EVERY
-- side (customer/driver/restaurant), so this inserts up to 3 ledger rows per
-- transition rather than minting a promo code.
--
-- Clawback: if a delivered order later moves to a non-delivered status (today
-- only 'cancelled' — orders.status has no 'refunded' state), we insert
-- mirroring negative rows so the next tier sweep (044) can demote correctly.
--
-- Non-destructive: new functions + triggers only.

-- ============================================================================
-- accrue_loyalty_on_delivery — fires when orders.status -> 'delivered'.
-- ============================================================================
create or replace function public.accrue_loyalty_on_delivery()
returns trigger
language plpgsql
security definer set search_path = public, pg_temp
as $$
declare
  v_rate         int;
  v_mult         int;
  v_customer_pts int;
  v_driver_id    uuid;
begin
  if new.status <> 'delivered' or old.status = 'delivered' then return new; end if;

  select coalesce((value #>> '{}')::int, 10) into v_rate
    from public.platform_settings where key = 'loyalty_points_per_egp';

  -- Lock (or create) the customer's tier row first so the multiplier read and
  -- the ledger insert use a consistent snapshot under concurrent deliveries.
  insert into public.customer_loyalty (user_id) values (new.user_id)
    on conflict (user_id) do nothing;
  perform 1 from public.customer_loyalty where user_id = new.user_id for update;

  select case
           when tier = 'gold'   then (select coalesce((value #>> '{}')::int, 150) from public.platform_settings where key = 'loyalty_tier_multiplier_gold')
           when tier = 'silver' then (select coalesce((value #>> '{}')::int, 125) from public.platform_settings where key = 'loyalty_tier_multiplier_silver')
           else 100
         end
    into v_mult
    from public.customer_loyalty where user_id = new.user_id;

  v_customer_pts := (floor(coalesce(new.subtotal_egp,0)::numeric / greatest(v_rate,1)) * v_mult) / 100;

  if v_customer_pts > 0 then
    insert into public.loyalty_points_ledger (subject_type, subject_id, delta_points, reason, ref_order_id)
    values ('customer', new.user_id, v_customer_pts, 'order_earn', new.id);

    update public.customer_loyalty
       set points_balance = points_balance + v_customer_pts,
           updated_at = now()
     where user_id = new.user_id;
  end if;

  -- Driver: 1 ledger point per delivery (volume input to the driver tier sweep).
  if new.assigned_driver_id is not null then
    insert into public.loyalty_points_ledger (subject_type, subject_id, delta_points, reason, ref_order_id)
    values ('driver', new.assigned_driver_id, 1, 'order_earn', new.id);
  end if;

  -- Restaurant: 1 ledger point per delivered order (volume input to the tier sweep).
  insert into public.loyalty_points_ledger (subject_type, subject_id, delta_points, reason, ref_order_id)
  values ('restaurant', new.restaurant_id, 1, 'order_earn', new.id);

  return new;
exception when others then
  return new;  -- never block the delivery transition on loyalty bookkeeping
end;
$$;

revoke all on function public.accrue_loyalty_on_delivery() from public, anon, authenticated;

drop trigger if exists orders_accrue_loyalty on public.orders;
create trigger orders_accrue_loyalty
  after update of status on public.orders
  for each row execute function public.accrue_loyalty_on_delivery();

-- ============================================================================
-- clawback_loyalty_on_reversal — fires when a DELIVERED order moves away from
-- 'delivered' (today: only -> 'cancelled'). Mirrors the earn amounts as
-- negative ledger rows so the next sweep can demote tier / debit balance.
-- ============================================================================
create or replace function public.clawback_loyalty_on_reversal()
returns trigger
language plpgsql
security definer set search_path = public, pg_temp
as $$
declare
  v_customer_pts int := 0;
  v_driver_pts   int := 0;
  v_rest_pts     int := 0;
begin
  if old.status <> 'delivered' or new.status = 'delivered' then return new; end if;

  select coalesce(sum(delta_points),0) into v_customer_pts
    from public.loyalty_points_ledger
   where subject_type = 'customer' and ref_order_id = new.id and reason = 'order_earn';

  select coalesce(sum(delta_points),0) into v_driver_pts
    from public.loyalty_points_ledger
   where subject_type = 'driver' and ref_order_id = new.id and reason = 'order_earn';

  select coalesce(sum(delta_points),0) into v_rest_pts
    from public.loyalty_points_ledger
   where subject_type = 'restaurant' and ref_order_id = new.id and reason = 'order_earn';

  if v_customer_pts > 0 then
    insert into public.loyalty_points_ledger (subject_type, subject_id, delta_points, reason, ref_order_id)
    values ('customer', new.user_id, -v_customer_pts, 'clawback', new.id);

    update public.customer_loyalty
       set points_balance = greatest(0, points_balance - v_customer_pts),
           updated_at = now()
     where user_id = new.user_id;
  end if;

  if v_driver_pts > 0 and new.assigned_driver_id is not null then
    insert into public.loyalty_points_ledger (subject_type, subject_id, delta_points, reason, ref_order_id)
    values ('driver', new.assigned_driver_id, -v_driver_pts, 'clawback', new.id);
  end if;

  if v_rest_pts > 0 then
    insert into public.loyalty_points_ledger (subject_type, subject_id, delta_points, reason, ref_order_id)
    values ('restaurant', new.restaurant_id, -v_rest_pts, 'clawback', new.id);
  end if;

  return new;
exception when others then
  return new;  -- never block the status transition on loyalty bookkeeping
end;
$$;

revoke all on function public.clawback_loyalty_on_reversal() from public, anon, authenticated;

drop trigger if exists orders_clawback_loyalty on public.orders;
create trigger orders_clawback_loyalty
  after update of status on public.orders
  for each row execute function public.clawback_loyalty_on_reversal();

comment on function public.accrue_loyalty_on_delivery is
  'On orders.status -> delivered, credits customer/driver/restaurant loyalty_points_ledger rows. Customer points_balance updated immediately; tier recompute happens in the nightly sweep.';
comment on function public.clawback_loyalty_on_reversal is
  'On a DELIVERED order reversing to a non-delivered status (today: cancelled only), inserts mirroring negative ledger rows and debits the customer balance. Tier demotion happens in the next sweep.';
```

- [ ] **Step 2: Write a local SQL validation script exercising both triggers**

Following the project's local-SQL-validation approach, write a scratch script
that: inserts a test user/customer_loyalty row, a test restaurant, a test
driver, an order with `subtotal_egp = 200`; updates `status` to `'delivered'`
and asserts three new `loyalty_points_ledger` rows exist (customer delta = 20
at `loyalty_points_per_egp=10`/bronze multiplier 100, driver delta = 1,
restaurant delta = 1) and `customer_loyalty.points_balance` incremented by 20;
then updates `status` to `'cancelled'` and asserts three more ledger rows
exist with delta = -20/-1/-1 and `points_balance` back to 0.

```bash
psql "$LOCAL_TEST_DSN" -f supabase/migrations/044_loyalty_earn_clawback.sql
psql "$LOCAL_TEST_DSN" -f /tmp/test_loyalty_earn_clawback.sql
```

Expected: all assertions pass (script should `raise exception` on mismatch
so a non-zero psql exit signals failure).

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/044_loyalty_earn_clawback.sql
git commit -m "feat(db): accrue and clawback loyalty points on order delivery/reversal"
```

---

### Task 4: Nightly tier sweep (pg_cron)

**Files:**
- Create: `supabase/migrations/045_loyalty_tier_sweep.sql`

**Interfaces:**
- Consumes: `loyalty_points_ledger`, `customer_loyalty`, `driver_loyalty`, `restaurant_loyalty` (Tasks 1–2), `order_assignments` (existing, for driver acceptance rate), `orders.rating_delivery` (existing, for driver rating), `restaurants.commission_pct`/`featured` (existing).
- Produces: function `public.loyalty_tier_sweep() returns int` (`SECURITY DEFINER`, granted to `postgres` only), a `pg_cron` job `sharmeats-loyalty-tier-sweep` scheduled daily.

- [ ] **Step 1: Write the migration file**

```sql
-- 045_loyalty_tier_sweep.sql
-- Three-sided loyalty system, part 4: the nightly tier-recompute sweep.
--
-- Mirrors dispatch_sweep() (025): one SECURITY DEFINER function, run by
-- pg_cron, granted only to postgres, wrapped so one subject's failure
-- (raise warning) never aborts the whole sweep.
--
-- Customer tier: from loyalty_points_ledger, trailing 12 months.
-- Driver tier:   from order_assignments (volume + acceptance) + orders
--                ratings, trailing 90 days, gated by a quality floor.
-- Restaurant tier: from orders (delivered count), trailing 90 days.
-- All three then write derived perks (multiplier is read live by the earn
-- trigger; driver bonus/first-look and restaurant commission/featured are
-- written directly here).
--
-- Non-destructive: new function + one cron job.

create or replace function public.loyalty_tier_sweep()
returns int  -- number of subject rows updated this run
language plpgsql
security definer set search_path = public, pg_temp
as $$
declare
  v_count int := 0;
  v_rec   record;
  v_silver_pts int; v_gold_pts int;
  v_drv_silver int; v_drv_gold int; v_min_accept numeric; v_min_rating numeric;
  v_drv_bonus_s int; v_drv_bonus_g int; v_drv_first_look_g int;
  v_rest_silver int; v_rest_gold int; v_rest_disc_s numeric; v_rest_disc_g numeric;
  v_new_tier text;
begin
  select coalesce((value #>> '{}')::int, 500)  into v_silver_pts from public.platform_settings where key = 'loyalty_customer_silver_threshold';
  select coalesce((value #>> '{}')::int, 2000) into v_gold_pts   from public.platform_settings where key = 'loyalty_customer_gold_threshold';
  select coalesce((value #>> '{}')::int, 60)   into v_drv_silver from public.platform_settings where key = 'loyalty_driver_silver_threshold';
  select coalesce((value #>> '{}')::int, 200)  into v_drv_gold   from public.platform_settings where key = 'loyalty_driver_gold_threshold';
  select coalesce((value #>> '{}')::numeric, 80)  into v_min_accept from public.platform_settings where key = 'loyalty_driver_min_acceptance_pct';
  select coalesce((value #>> '{}')::numeric, 450) into v_min_rating from public.platform_settings where key = 'loyalty_driver_min_rating';
  select coalesce((value #>> '{}')::int, 5)  into v_drv_bonus_s from public.platform_settings where key = 'loyalty_driver_bonus_silver_egp';
  select coalesce((value #>> '{}')::int, 10) into v_drv_bonus_g from public.platform_settings where key = 'loyalty_driver_bonus_gold_egp';
  select coalesce((value #>> '{}')::int, 8)  into v_drv_first_look_g from public.platform_settings where key = 'loyalty_driver_first_look_gold_seconds';
  select coalesce((value #>> '{}')::int, 50)  into v_rest_silver from public.platform_settings where key = 'loyalty_restaurant_silver_threshold';
  select coalesce((value #>> '{}')::int, 200) into v_rest_gold   from public.platform_settings where key = 'loyalty_restaurant_gold_threshold';
  select coalesce((value #>> '{}')::numeric, 100) into v_rest_disc_s from public.platform_settings where key = 'loyalty_restaurant_silver_discount_pct';
  select coalesce((value #>> '{}')::numeric, 200) into v_rest_disc_g from public.platform_settings where key = 'loyalty_restaurant_gold_discount_pct';

  -- ---- Customers: rolling-12mo points from the ledger ----
  for v_rec in
    select cl.user_id,
           coalesce(sum(l.delta_points) filter (where l.created_at > now() - interval '12 months'), 0) as pts
      from public.customer_loyalty cl
      left join public.loyalty_points_ledger l
        on l.subject_type = 'customer' and l.subject_id = cl.user_id
     group by cl.user_id
  loop
    begin
      v_new_tier := case when v_rec.pts >= v_gold_pts then 'gold'
                          when v_rec.pts >= v_silver_pts then 'silver'
                          else 'bronze' end;
      update public.customer_loyalty
         set tier = v_new_tier, points_rolling_12mo = v_rec.pts, updated_at = now()
       where user_id = v_rec.user_id and (tier <> v_new_tier or points_rolling_12mo <> v_rec.pts);
      if found then v_count := v_count + 1; end if;
    exception when others then
      raise warning 'loyalty_tier_sweep customer(%) failed: %', v_rec.user_id, sqlerrm;
    end;
  end loop;

  -- ---- Drivers: rolling-90d deliveries + quality gate ----
  -- NOTE: order_assignments.status never reaches 'completed' anywhere in this
  -- codebase (driver_respond only ever sets 'accepted'/'rejected' — see
  -- 011_rpcs.sql). Delivery volume MUST be counted from orders.status =
  -- 'delivered' joined on assigned_driver_id, not from order_assignments.
  for v_rec in
    select d.id as driver_id,
           coalesce((
             select count(*) from public.orders o
              where o.assigned_driver_id = d.id and o.status = 'delivered'
                and o.placed_at > now() - interval '90 days'
           ), 0) as deliveries,
           coalesce(
             100.0 * count(*) filter (where oa.status = 'accepted' and oa.assigned_at > now() - interval '90 days')
             / nullif(count(*) filter (where oa.status in ('accepted','rejected') and oa.assigned_at > now() - interval '90 days'), 0),
             100.0
           ) as acceptance_pct,
           coalesce((
             select avg(o.rating_delivery)::numeric from public.orders o
              where o.assigned_driver_id = d.id and o.rating_delivery is not null
                and o.placed_at > now() - interval '90 days'
           ), 5.0) as avg_rating
      from public.drivers d
      left join public.order_assignments oa on oa.driver_id = d.id
     group by d.id
  loop
    begin
      insert into public.driver_loyalty (driver_id) values (v_rec.driver_id)
        on conflict (driver_id) do nothing;

      v_new_tier := 'bronze';
      if v_rec.deliveries >= v_drv_gold
         and v_rec.acceptance_pct >= v_min_accept
         and v_rec.avg_rating * 100 >= v_min_rating then
        v_new_tier := 'gold';
      elsif v_rec.deliveries >= v_drv_silver
         and v_rec.acceptance_pct >= v_min_accept
         and v_rec.avg_rating * 100 >= v_min_rating then
        v_new_tier := 'silver';
      end if;

      update public.driver_loyalty
         set tier = v_new_tier,
             deliveries_rolling_90d = v_rec.deliveries,
             acceptance_rate_snapshot = v_rec.acceptance_pct,
             rating_snapshot = v_rec.avg_rating,
             bonus_per_delivery_egp = case v_new_tier when 'gold' then v_drv_bonus_g when 'silver' then v_drv_bonus_s else 0 end,
             first_look_seconds = case v_new_tier when 'gold' then v_drv_first_look_g else 0 end,
             updated_at = now()
       where driver_id = v_rec.driver_id;
      v_count := v_count + 1;
    exception when others then
      raise warning 'loyalty_tier_sweep driver(%) failed: %', v_rec.driver_id, sqlerrm;
    end;
  end loop;

  -- ---- Restaurants: rolling-90d delivered order count ----
  for v_rec in
    select r.id as restaurant_id,
           coalesce(count(o.id) filter (
             where o.status = 'delivered' and o.placed_at > now() - interval '90 days'
           ), 0) as delivered_count,
           r.commission_pct as base_commission
      from public.restaurants r
      left join public.orders o on o.restaurant_id = r.id
     group by r.id, r.commission_pct
  loop
    begin
      insert into public.restaurant_loyalty (restaurant_id) values (v_rec.restaurant_id)
        on conflict (restaurant_id) do nothing;

      v_new_tier := 'bronze';
      if v_rec.delivered_count >= v_rest_gold then
        v_new_tier := 'gold';
      elsif v_rec.delivered_count >= v_rest_silver then
        v_new_tier := 'silver';
      end if;

      update public.restaurant_loyalty
         set tier = v_new_tier,
             orders_rolling_90d = v_rec.delivered_count,
             commission_discount_pct = case v_new_tier when 'gold' then v_rest_disc_g when 'silver' then v_rest_disc_s else 0 end,
             updated_at = now()
       where restaurant_id = v_rec.restaurant_id;

      -- Auto-apply: effective commission = greatest(0, original tier-0 rate -
      -- discount). We treat the restaurant's CURRENT commission_pct plus its
      -- CURRENT discount as the base, so re-running the sweep is idempotent
      -- (adding the old discount back before subtracting the new one).
      update public.restaurants
         set commission_pct = greatest(0,
               v_rec.base_commission + coalesce((select rl.commission_discount_pct from public.restaurant_loyalty rl where rl.restaurant_id = v_rec.restaurant_id and rl.updated_at < now()), 0)
               - (case v_new_tier when 'gold' then v_rest_disc_g when 'silver' then v_rest_disc_s else 0 end)),
             featured = (v_new_tier = 'gold')
       where id = v_rec.restaurant_id;

      v_count := v_count + 1;
    exception when others then
      raise warning 'loyalty_tier_sweep restaurant(%) failed: %', v_rec.restaurant_id, sqlerrm;
    end;
  end loop;

  return v_count;
end;
$$;

comment on function public.loyalty_tier_sweep is
  'Nightly recompute of all three loyalty tiers from loyalty_points_ledger/order history. Writes customer/driver/restaurant_loyalty and auto-applies restaurant commission_pct/featured. Run by pg_cron; never granted to clients.';

revoke all on function public.loyalty_tier_sweep() from public, anon, authenticated;
grant execute on function public.loyalty_tier_sweep() to postgres;

create extension if not exists pg_cron;

do $$
begin
  perform cron.unschedule('sharmeats-loyalty-tier-sweep');
exception when others then
  null;  -- not scheduled yet
end $$;

select cron.schedule('sharmeats-loyalty-tier-sweep', '0 2 * * *', $$select public.loyalty_tier_sweep();$$);
```

- [ ] **Step 2: Note the restaurant-commission idempotency risk and fix it**

The `commission_pct` update above tries to "add back the old discount, then
subtract the new one" using the JUST-updated `restaurant_loyalty` row, which
is wrong (it reads the row after its own update in the same statement,
so `rl.updated_at < now()` is unreliable). Rewrite this block to snapshot the
**previous** discount into a variable BEFORE updating `restaurant_loyalty`:

```sql
      -- (replace the two `update` statements above with:)
      declare
        v_prev_discount numeric;
        v_next_discount numeric;
      begin
        select commission_discount_pct into v_prev_discount
          from public.restaurant_loyalty where restaurant_id = v_rec.restaurant_id;
        v_prev_discount := coalesce(v_prev_discount, 0);
        v_next_discount := case v_new_tier when 'gold' then v_rest_disc_g when 'silver' then v_rest_disc_s else 0 end;

        update public.restaurant_loyalty
           set tier = v_new_tier,
               orders_rolling_90d = v_rec.delivered_count,
               commission_discount_pct = v_next_discount,
               updated_at = now()
         where restaurant_id = v_rec.restaurant_id;

        update public.restaurants
           set commission_pct = greatest(0, v_rec.base_commission + v_prev_discount - v_next_discount),
               featured = (v_new_tier = 'gold')
         where id = v_rec.restaurant_id;
      end;
```

Apply this replacement to the restaurant loop in Step 1's file before
proceeding.

- [ ] **Step 3: Validate locally**

Write a scratch script that seeds a restaurant with `commission_pct = 12.0`
and 60 delivered orders in the last 90 days, runs `loyalty_tier_sweep()`
twice in a row, and asserts `commission_pct` is `11.0` (12.0 - 1.0 silver
discount) after BOTH runs (not `10.0` after the second — this is the
idempotency check for the Step 2 fix). Also seed a driver with 65 `orders`
rows where `assigned_driver_id` = that driver and `status = 'delivered'`
(NOT `order_assignments.status = 'completed'` — that value is never
written anywhere in this codebase; see the Step 1 comment), plus enough
`order_assignments` rows with `status = 'accepted'`/`'rejected'` to yield
90% acceptance, and enough `orders.rating_delivery` values averaging 4.8;
assert `driver_loyalty.tier = 'silver'`, `bonus_per_delivery_egp = 5`; then
seed a second driver with the same delivered-order volume but only 60%
acceptance and assert they stay `'bronze'` (quality gate).

```bash
psql "$LOCAL_TEST_DSN" -f supabase/migrations/045_loyalty_tier_sweep.sql
psql "$LOCAL_TEST_DSN" -f /tmp/test_loyalty_tier_sweep.sql
```

Expected: all assertions pass, especially the double-run idempotency check.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/045_loyalty_tier_sweep.sql
git commit -m "feat(db): nightly loyalty tier sweep (customer/driver/restaurant)"
```

---

### Task 5: Client-facing RPCs (read status, redeem points)

**Files:**
- Create: `supabase/migrations/046_loyalty_rpcs.sql`

**Interfaces:**
- Consumes: `customer_loyalty`, `driver_loyalty`, `restaurant_loyalty`, `loyalty_points_ledger` (Tasks 1–2), `promo_codes` (existing, from `019_promo_codes.sql`).
- Produces: `public.my_loyalty_status() returns table(tier text, points_balance int, points_rolling_12mo int)` (customer, `authenticated`), `public.my_loyalty_history(p_limit int default 20) returns setof loyalty_points_ledger` (customer, `authenticated`), `public.redeem_points(p_points int) returns text` (customer, `authenticated`), `public.my_driver_tier() returns table(tier text, deliveries_rolling_90d int, bonus_per_delivery_egp int, first_look_seconds int, acceptance_rate_snapshot numeric, rating_snapshot numeric)` (driver, `authenticated`), `public.my_restaurant_tier() returns table(tier text, orders_rolling_90d int, commission_pct numeric, featured boolean)` (merchant staff, `authenticated`).

- [ ] **Step 1: Write the migration file**

```sql
-- 046_loyalty_rpcs.sql
-- Three-sided loyalty system, part 5: client-facing read + redeem RPCs.
--
-- Same shape as my_referral_code (026): SECURITY DEFINER, auth.uid() check,
-- narrow return, granted to authenticated only. No direct table access for
-- driver_loyalty/restaurant_loyalty (no client policy exists on those tables
-- per migration 042) — these RPCs are the only read path.
--
-- Non-destructive: new functions only.

-- ============================================================================
-- Customer: status + history + redeem
-- ============================================================================
create or replace function public.my_loyalty_status()
returns table (tier text, points_balance int, points_rolling_12mo int)
language sql
stable
security definer set search_path = public, pg_temp
as $$
  select cl.tier, cl.points_balance, cl.points_rolling_12mo
    from public.customer_loyalty cl
   where cl.user_id = auth.uid();
$$;
grant execute on function public.my_loyalty_status() to authenticated;

create or replace function public.my_loyalty_history(p_limit int default 20)
returns setof public.loyalty_points_ledger
language sql
stable
security definer set search_path = public, pg_temp
as $$
  select * from public.loyalty_points_ledger
   where subject_type = 'customer' and subject_id = auth.uid()
   order by created_at desc
   limit greatest(1, least(p_limit, 100));
$$;
grant execute on function public.my_loyalty_history(int) to authenticated;

-- redeem_points: debit N points, mint a one-time fixed promo code worth
-- N points converted to EGP at the SAME rate points were earned (1 point =
-- loyalty_points_per_egp EGP / multiplier-neutral — redemption value is
-- always at the bronze rate to keep the exchange rate simple and predictable
-- for customers regardless of the tier they earned it at).
create or replace function public.redeem_points(p_points int)
returns text
language plpgsql
security definer set search_path = public, pg_temp
as $$
declare
  v_user    uuid := auth.uid();
  v_balance int;
  v_rate    int;
  v_value_egp int;
  v_code    text;
begin
  if v_user is null then raise exception 'AUTH_REQUIRED' using errcode = 'check_violation'; end if;
  if p_points is null or p_points <= 0 then raise exception 'INVALID_POINTS' using errcode = 'check_violation'; end if;

  perform 1 from public.customer_loyalty where user_id = v_user for update;
  select points_balance into v_balance from public.customer_loyalty where user_id = v_user;
  if v_balance is null or v_balance < p_points then
    raise exception 'INSUFFICIENT_POINTS' using errcode = 'check_violation';
  end if;

  select coalesce((value #>> '{}')::int, 10) into v_rate
    from public.platform_settings where key = 'loyalty_points_per_egp';
  v_value_egp := greatest(1, p_points * v_rate / 100);  -- points were stored /100-normalized in the earn trigger's floor division; this inverts at the bronze rate

  v_code := 'LOY-' || substr(replace(gen_random_uuid()::text,'-',''), 1, 6);
  insert into public.promo_codes (code, kind, value, per_user_limit, is_active)
  values (upper(v_code), 'fixed', v_value_egp, 1, true);

  update public.customer_loyalty
     set points_balance = points_balance - p_points, updated_at = now()
   where user_id = v_user;

  insert into public.loyalty_points_ledger (subject_type, subject_id, delta_points, reason)
  values ('customer', v_user, -p_points, 'redeem');

  return upper(v_code);
end;
$$;
grant execute on function public.redeem_points(int) to authenticated;

-- ============================================================================
-- Driver: my_driver_tier
-- ============================================================================
create or replace function public.my_driver_tier()
returns table (
  tier text, deliveries_rolling_90d int, bonus_per_delivery_egp int,
  first_look_seconds int, acceptance_rate_snapshot numeric, rating_snapshot numeric
)
language sql
stable
security definer set search_path = public, pg_temp
as $$
  select dl.tier, dl.deliveries_rolling_90d, dl.bonus_per_delivery_egp,
         dl.first_look_seconds, dl.acceptance_rate_snapshot, dl.rating_snapshot
    from public.driver_loyalty dl
    join public.drivers d on d.id = dl.driver_id
   where d.profile_id = auth.uid();
$$;
grant execute on function public.my_driver_tier() to authenticated;

-- ============================================================================
-- Restaurant: my_restaurant_tier (merchant_staff-scoped, same resolution join
-- used by getMyRestaurant() in the restaurant/merchant-web apps)
-- ============================================================================
create or replace function public.my_restaurant_tier()
returns table (tier text, orders_rolling_90d int, commission_pct numeric, featured boolean)
language sql
stable
security definer set search_path = public, pg_temp
as $$
  select rl.tier, rl.orders_rolling_90d, r.commission_pct, coalesce(r.featured, false)
    from public.restaurant_loyalty rl
    join public.restaurants r on r.id = rl.restaurant_id
    join public.merchant_staff ms on ms.restaurant_id = r.id
   where ms.profile_id = auth.uid()
   limit 1;
$$;
grant execute on function public.my_restaurant_tier() to authenticated;

comment on function public.redeem_points is
  'Debits the caller''s point balance and mints a one-time LOY-XXXXXX fixed promo_codes row (per_user_limit=1), same redemption shape as the referral reward path (026). Raises INSUFFICIENT_POINTS if the balance is too low.';
```

- [ ] **Step 2: Validate locally**

Write a scratch script that seeds `customer_loyalty.points_balance = 100`,
calls `redeem_points(50)` as that user (via `set local role` / a test JWT
claim matching the project's existing local-validation approach for
`auth.uid()`-dependent functions), and asserts: return value matches
`^LOY-[A-Z0-9]{6}$`, `points_balance` is now 50, a `promo_codes` row exists
with that code and `kind='fixed'`, `per_user_limit=1`, and a `-50` ledger row
with `reason='redeem'` exists. Also assert `redeem_points(1000)` (more than
balance) raises `INSUFFICIENT_POINTS`.

```bash
psql "$LOCAL_TEST_DSN" -f supabase/migrations/046_loyalty_rpcs.sql
psql "$LOCAL_TEST_DSN" -f /tmp/test_loyalty_rpcs.sql
```

Expected: all assertions pass.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/046_loyalty_rpcs.sql
git commit -m "feat(db): loyalty status/history/redeem RPCs for customer, driver, restaurant"
```

---

### Task 6: Wire driver first-look into the dispatch offer path

**Files:**
- Create: `supabase/migrations/047_loyalty_first_look_dispatch.sql`

**Interfaces:**
- Consumes: `public.driver_loyalty.first_look_seconds` (Task 2/4), `public.auto_assign_order(uuid)` and `public.dispatch_sweep()` (existing, from `025_auto_dispatch.sql`).
- Produces: replacement of `public.auto_assign_order(uuid)` that honors a per-driver first-look head start.

The design spec requires: "Gold-tier drivers in a zone receive a new order
offer this many seconds before it broadcasts platform-wide... a delay in the
existing offer-creation path... not a change to `nearest_drivers` distance
scoring." Concretely: `auto_assign_order` already picks the SINGLE nearest
eligible driver and offers it to them — it never broadcasts to multiple
drivers at once, so there's no existing "platform-wide broadcast" moment to
delay non-Gold drivers relative to. The correct interpretation that preserves
"no change to distance scoring" is: **delay `dispatch_sweep`'s decision to
call `auto_assign_order` for a given order by `first_look_seconds`, but only
for the FIRST offer attempt on that order, so a Gold-tier driver who is
online and nearest gets a head start over a scenario where the order would
otherwise be picked up faster by a re-offer chain.** Since `auto_assign_order`
already always offers to the nearest eligible driver regardless of tier, the
practical, safe implementation is: **when picking the nearest eligible
driver, break ties in favor of higher `first_look_seconds` within a small
distance band, and additionally give Gold-tier drivers a shorter effective
`offer_expires_at` grace window (they get first crack because the sweep
tries them first within the existing nearest-first ordering when distances
are close).** Re-reading the spec's actual constraint (no change to distance
SCORING), the simplest faithful implementation is a genuine time delay: hold
the auto-offer back by `first_look_seconds` if the nearest eligible driver is
NOT Gold-tier but a Gold-tier driver is within the same radius — giving that
Gold driver's client-side polling/push a head start to accept before the
order is offered to the nearest non-Gold driver. Implement it as follows.

- [ ] **Step 1: Write the migration file**

```sql
-- 047_loyalty_first_look_dispatch.sql
-- Three-sided loyalty system, part 6: Gold-tier driver first-look dispatch.
--
-- auto_assign_order (025) already offers each order to the single nearest
-- eligible driver — there is no multi-driver broadcast moment to delay. To
-- honor "Gold drivers see offers first" WITHOUT touching nearest_drivers'
-- distance scoring, we hold back the auto-offer to a non-Gold nearest driver
-- for driver_loyalty.first_look_seconds IF a Gold-tier driver is also
-- in-radius and eligible — giving that Gold driver's push notification (sent
-- separately, see below) a head start to open the app and self-accept via
-- the manual accept path before the sweep locks in the non-Gold offer.
--
-- Non-destructive: replaces auto_assign_order (CREATE OR REPLACE, same
-- signature/return type as 025); no schema change.

create or replace function public.auto_assign_order(p_order_id uuid)
returns uuid
language plpgsql
security definer set search_path = public, pg_temp
as $$
declare
  v_order       public.orders;
  v_radius      int;
  v_ttl         int;
  v_driver      uuid;
  v_prof        uuid;
  v_asg_id      uuid;
  v_base        text;
  v_gold_driver uuid;
  v_first_look  int;
  v_held_since  timestamptz;
begin
  select * into v_order from public.orders where id = p_order_id for update;
  if not found then return null; end if;

  if exists (
    select 1 from public.order_assignments
     where order_id = p_order_id and status in ('offered','accepted')
  ) then
    return null;
  end if;

  if v_order.status not in ('accepted','preparing','ready') then
    return null;
  end if;
  if v_order.dropoff_geo is null then
    return null;
  end if;

  select coalesce((value #>> '{}')::int, 5000) into v_radius
    from public.platform_settings where key = 'dispatch_radius_m';
  select coalesce((value #>> '{}')::int, 45) into v_ttl
    from public.platform_settings where key = 'dispatch_offer_ttl_seconds';

  -- Nearest eligible driver who hasn't already seen this order (unchanged
  -- from 025 — distance scoring itself is never modified).
  select nd.driver_id into v_driver
    from public.nearest_drivers(v_order.dropoff_geo, coalesce(v_radius,5000), 20) nd
   where not exists (
           select 1 from public.order_assignments oa
            where oa.order_id = p_order_id
              and oa.driver_id = nd.driver_id
              and oa.status in ('offered','rejected','reassigned')
         )
   order by nd.distance_m asc
   limit 1;

  if v_driver is null then
    return null;
  end if;

  -- [046] First-look hold: if the nearest driver is NOT Gold-tier, but a
  -- Gold-tier driver is also in-radius/eligible for this order, hold the
  -- offer back for that Gold driver's first_look_seconds — but only once
  -- per order (tracked via a transient marker row keyed by order_id in
  -- platform_settings-style would be overkill; instead we check order age:
  -- if the order became eligible for dispatch less than first_look_seconds
  -- ago, skip this tick so the next sweep tick (20s later, per 025) retries.
  -- Since first_look_seconds is small (single-digit to low tens), a 20s
  -- sweep cadence means this typically costs the order at most one tick.
  select dl.first_look_seconds into v_first_look
    from public.driver_loyalty dl where dl.driver_id = v_driver;

  if coalesce(v_first_look, 0) = 0 then
    -- Nearest driver is not (or has no) elevated first-look — but check
    -- whether a Gold driver is also in-radius and hasn't been offered yet.
    select nd.driver_id into v_gold_driver
      from public.nearest_drivers(v_order.dropoff_geo, coalesce(v_radius,5000), 20) nd
      join public.driver_loyalty dl on dl.driver_id = nd.driver_id and dl.tier = 'gold'
     where not exists (
             select 1 from public.order_assignments oa
              where oa.order_id = p_order_id
                and oa.driver_id = nd.driver_id
                and oa.status in ('offered','rejected','reassigned')
           )
     order by nd.distance_m asc
     limit 1;

    if v_gold_driver is not null and v_gold_driver <> v_driver then
      select coalesce((value #>> '{}')::int, 8) into v_first_look
        from public.platform_settings where key = 'loyalty_driver_first_look_gold_seconds';
      v_held_since := coalesce(v_order.updated_at, v_order.placed_at);
      if now() - v_held_since < make_interval(secs => coalesce(v_first_look,8)) then
        return null;  -- hold this tick; the Gold driver gets first crack via push
      end if;
    end if;
  end if;

  insert into public.order_assignments
    (order_id, driver_id, status, assigned_by, offer_expires_at)
  values
    (p_order_id, v_driver, 'offered', 'auto', now() + make_interval(secs => coalesce(v_ttl,45)))
  returning id into v_asg_id;

  update public.orders
     set assigned_driver_id = v_driver, dispatch_mode = 'auto'
   where id = p_order_id;

  select profile_id into v_prof from public.drivers where id = v_driver;
  select value #>> '{}' into v_base
    from public.platform_settings where key = 'functions_base_url';

  if v_prof is not null and v_base is not null and v_base <> '' then
    perform net.http_post(
      url     := v_base || '/expo-push',
      body    := jsonb_build_object(
                   'event', 'new_offer',
                   'orderId', p_order_id::text,
                   'recipientUserIds', jsonb_build_array(v_prof::text)
                 ),
      headers := '{"Content-Type": "application/json"}'::jsonb
    );
  end if;

  return v_driver;
exception when others then
  raise warning 'auto_assign_order(%) failed: % (%)', p_order_id, sqlerrm, sqlstate;
  return null;
end;
$$;

comment on function public.auto_assign_order is
  'Offers one order to the nearest eligible driver. [046] Holds the offer back up to loyalty_driver_first_look_gold_seconds if a Gold-tier driver is also in-radius and the nearest driver is not Gold, giving Gold drivers first crack without changing nearest_drivers distance scoring. Creates an auto order_assignments row + pushes the driver. Returns offered driver_id or NULL.';

revoke all on function public.auto_assign_order(uuid) from public, anon, authenticated;
grant execute on function public.auto_assign_order(uuid) to postgres;
```

- [ ] **Step 2: Validate locally**

Write a scratch script seeding two drivers at similar distance from an
order's dropoff — one Bronze (nearest), one Gold (slightly farther, still
in-radius) — and assert `auto_assign_order` returns `null` on the first
call (holding for the Gold driver's first-look window), then, after
advancing the order's `updated_at` past `first_look_seconds`, returns the
Bronze driver's id (falls through once the hold expires). Also seed a case
with NO Gold driver in-radius and assert the Bronze driver is offered
immediately (no regression to the 025 baseline behavior).

```bash
psql "$LOCAL_TEST_DSN" -f supabase/migrations/047_loyalty_first_look_dispatch.sql
psql "$LOCAL_TEST_DSN" -f /tmp/test_loyalty_first_look_dispatch.sql
```

Expected: all three assertions pass.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/047_loyalty_first_look_dispatch.sql
git commit -m "feat(db): give Gold-tier drivers a first-look dispatch window"
```

---

## Part B — Customer app (Rewards tab)

### Task 7: Types + repositories (mock + Supabase)

**Files:**
- Modify: `apps/customer/src/data/types.ts`
- Create: `apps/customer/src/data/repositories/rewards.ts`
- Create: `apps/customer/src/data/supabase/rewards.ts`
- Modify: `apps/customer/src/data/supabase/mappers.ts`
- Modify: `apps/customer/src/data/index.ts`
- Test: `apps/customer/src/data/supabase/mappers.test.ts` (extend)

**Interfaces:**
- Produces: types `RewardsTier = 'bronze' | 'silver' | 'gold'`, `RewardsStatus { tier: RewardsTier; pointsBalance: number; pointsRolling12mo: number }`, `RewardsHistoryEntry { id: string; deltaPoints: number; reason: string; refOrderId: string | null; createdAt: number }`.
- Produces: `rewardsRepo` / `rewardsRepoSupabase` each with `getStatus(): Promise<RewardsStatus>`, `listHistory(limit?: number): Promise<RewardsHistoryEntry[]>`, `redeem(points: number): Promise<string>` (returns the minted promo code).
- Consumes (Supabase side): RPCs `my_loyalty_status`, `my_loyalty_history`, `redeem_points` from Task 5 (Task 6 is unrelated to this file — it's the dispatch first-look change).

- [ ] **Step 1: Add types**

Add to `apps/customer/src/data/types.ts` (append near the other domain types,
following the file's existing plain-interface style):

```ts
export type RewardsTier = 'bronze' | 'silver' | 'gold';

export interface RewardsStatus {
  tier: RewardsTier;
  pointsBalance: number;
  pointsRolling12mo: number;
}

export interface RewardsHistoryEntry {
  id: string;
  deltaPoints: number;
  reason: 'order_earn' | 'redeem' | 'clawback' | 'tier_bonus';
  refOrderId: string | null;
  createdAt: number;
}
```

- [ ] **Step 2: Write the mock repository**

Create `apps/customer/src/data/repositories/rewards.ts`:

```ts
import type { RewardsHistoryEntry, RewardsStatus } from '../types';

const delay = <T>(value: T, ms = 40): Promise<T> =>
  new Promise((resolve) => setTimeout(() => resolve(value), ms));

let status: RewardsStatus = { tier: 'silver', pointsBalance: 340, pointsRolling12mo: 620 };

const history: RewardsHistoryEntry[] = [
  { id: 'h1', deltaPoints: 25, reason: 'order_earn', refOrderId: 'order-1', createdAt: Date.now() - 86400000 },
  { id: 'h2', deltaPoints: -100, reason: 'redeem', refOrderId: null, createdAt: Date.now() - 172800000 },
];

export const rewardsRepo = {
  async getStatus(): Promise<RewardsStatus> {
    return delay(status);
  },
  async listHistory(limit = 20): Promise<RewardsHistoryEntry[]> {
    return delay(history.slice(0, limit));
  },
  async redeem(points: number): Promise<string> {
    if (points > status.pointsBalance) throw new Error('INSUFFICIENT_POINTS');
    status = { ...status, pointsBalance: status.pointsBalance - points };
    history.unshift({ id: `h${history.length + 1}`, deltaPoints: -points, reason: 'redeem', refOrderId: null, createdAt: Date.now() });
    return delay('LOY-DEMO42');
  },
};
```

- [ ] **Step 3: Add mappers**

Append to `apps/customer/src/data/supabase/mappers.ts` (near the other
`rowTo*` functions):

```ts
export function rowToRewardsStatus(row: {
  tier: string;
  points_balance: number;
  points_rolling_12mo: number;
}): RewardsStatus {
  return {
    tier: row.tier as RewardsStatus['tier'],
    pointsBalance: row.points_balance,
    pointsRolling12mo: row.points_rolling_12mo,
  };
}

export function rowToRewardsHistoryEntry(row: {
  id: string;
  delta_points: number;
  reason: string;
  ref_order_id: string | null;
  created_at: string;
}): RewardsHistoryEntry {
  return {
    id: row.id,
    deltaPoints: row.delta_points,
    reason: row.reason as RewardsHistoryEntry['reason'],
    refOrderId: row.ref_order_id,
    createdAt: tsToMs(row.created_at) ?? Date.now(),
  };
}
```

Add `RewardsHistoryEntry, RewardsStatus` to the `import type { ... } from
'../types'` block at the top of `mappers.ts`.

- [ ] **Step 4: Write a mapper test**

Extend `apps/customer/src/data/supabase/mappers.test.ts` following its
existing fixture-row pattern:

```ts
import { rowToRewardsHistoryEntry, rowToRewardsStatus } from './mappers';

describe('rowToRewardsStatus', () => {
  it('maps a customer_loyalty row', () => {
    const result = rowToRewardsStatus({ tier: 'gold', points_balance: 500, points_rolling_12mo: 2100 });
    expect(result).toEqual({ tier: 'gold', pointsBalance: 500, pointsRolling12mo: 2100 });
  });
});

describe('rowToRewardsHistoryEntry', () => {
  it('maps a ledger row and parses the timestamp', () => {
    const result = rowToRewardsHistoryEntry({
      id: 'abc',
      delta_points: -50,
      reason: 'redeem',
      ref_order_id: null,
      created_at: '2026-07-01T12:00:00+00:00',
    });
    expect(result.deltaPoints).toBe(-50);
    expect(result.reason).toBe('redeem');
    expect(result.refOrderId).toBeNull();
    expect(typeof result.createdAt).toBe('number');
  });
});
```

- [ ] **Step 5: Run the test to verify it passes**

```bash
cd apps/customer && npm test -- mappers.test.ts
```

Expected: PASS (2 new tests).

- [ ] **Step 6: Write the Supabase repository**

Create `apps/customer/src/data/supabase/rewards.ts`:

```ts
import { getSupabase } from './client';
import { rowToRewardsHistoryEntry, rowToRewardsStatus } from './mappers';
import type { RewardsHistoryEntry, RewardsStatus } from '../types';

export const rewardsRepoSupabase = {
  async getStatus(): Promise<RewardsStatus> {
    const { data, error } = await getSupabase().rpc('my_loyalty_status');
    if (error) throw error;
    const row = Array.isArray(data) ? data[0] : data;
    if (!row) return { tier: 'bronze', pointsBalance: 0, pointsRolling12mo: 0 };
    return rowToRewardsStatus(row);
  },

  async listHistory(limit = 20): Promise<RewardsHistoryEntry[]> {
    const { data, error } = await getSupabase().rpc('my_loyalty_history', { p_limit: limit });
    if (error) throw error;
    return (data ?? []).map(rowToRewardsHistoryEntry);
  },

  async redeem(points: number): Promise<string> {
    const { data, error } = await getSupabase().rpc('redeem_points', { p_points: points });
    if (error) throw error;
    if (typeof data !== 'string' || data.length === 0) throw new Error('Redeem failed');
    return data;
  },
};
```

- [ ] **Step 7: Wire into the db facade**

In `apps/customer/src/data/index.ts`, add the import lines and the `rewards`
key to both branches of the `db` object:

```ts
import { rewardsRepo } from './repositories/rewards';
import { rewardsRepoSupabase } from './supabase/rewards';
```

```ts
export const db = useSupabase
  ? {
      auth: authRepoSupabase,
      restaurants: restaurantsRepoSupabase,
      menus: menusRepoSupabase,
      hotels: hotelsRepoSupabase,
      user: userRepoSupabase,
      orders: ordersRepoSupabase,
      rewards: rewardsRepoSupabase,
    }
  : {
      auth: authRepo,
      restaurants: restaurantsRepo,
      menus: menusRepo,
      hotels: hotelsRepo,
      user: userRepo,
      orders: ordersRepo,
      rewards: rewardsRepo,
    };
```

- [ ] **Step 8: Typecheck**

```bash
cd apps/customer && npm run typecheck
```

Expected: no errors.

- [ ] **Step 9: Commit**

```bash
git add apps/customer/src/data/types.ts apps/customer/src/data/repositories/rewards.ts \
        apps/customer/src/data/supabase/rewards.ts apps/customer/src/data/supabase/mappers.ts \
        apps/customer/src/data/supabase/mappers.test.ts apps/customer/src/data/index.ts
git commit -m "feat(customer): add rewards repository (mock + supabase)"
```

---

### Task 8: i18n copy (5 locales)

**Files:**
- Modify: `apps/customer/src/i18n/locales/en.json`
- Modify: `apps/customer/src/i18n/locales/ar.json`
- Modify: `apps/customer/src/i18n/locales/ru.json`
- Modify: `apps/customer/src/i18n/locales/it.json`
- Modify: `apps/customer/src/i18n/locales/de.json`

**Interfaces:**
- Produces: i18n keys `tabs.rewards`, `rewards.title`, `rewards.pointsBalance`, `rewards.tier`, `rewards.tierBronze`, `rewards.tierSilver`, `rewards.tierGold`, `rewards.progressToNext`, `rewards.redeemButton`, `rewards.redeemConfirm`, `rewards.redeemSuccess`, `rewards.redeemInsufficient`, `rewards.historyTitle`, `rewards.historyEmpty`, `rewards.perksFreeDelivery`, `rewards.perksMultiplier`, `rewards.perksPriority`.

- [ ] **Step 1: Add the English keys**

Add to `apps/customer/src/i18n/locales/en.json` (insert alphabetically /
near the `tabs.*` and other feature blocks per the file's existing
ordering — check the file first to match its convention, then append a
`rewards.*` block and one `tabs.rewards` key):

```json
"tabs.rewards": "Rewards",
"rewards.title": "Rewards",
"rewards.pointsBalance": "{points} points",
"rewards.tier": "{tier} tier",
"rewards.tierBronze": "Bronze",
"rewards.tierSilver": "Silver",
"rewards.tierGold": "Gold",
"rewards.progressToNext": "{points} points to {tier}",
"rewards.redeemButton": "Redeem points",
"rewards.redeemConfirm": "Redeem {points} points for a discount code?",
"rewards.redeemSuccess": "Code {code} added — apply it at checkout.",
"rewards.redeemInsufficient": "Not enough points yet.",
"rewards.historyTitle": "History",
"rewards.historyEmpty": "No activity yet — your first order will start earning points.",
"rewards.perksFreeDelivery": "Free delivery on qualifying orders",
"rewards.perksMultiplier": "{mult}x points on every order",
"rewards.perksPriority": "Priority support"
```

- [ ] **Step 2: Add matching keys to ar.json, ru.json, it.json, de.json**

Translate the same 16 keys into Arabic, Russian, Italian, and German,
matching each file's existing tone/register (check 2-3 neighboring keys in
each file first for terminology consistency — e.g. how "points"/"tier" or
similar loyalty-adjacent concepts, if any exist in `invite.*` keys, are
phrased). Keep placeholder tokens (`{points}`, `{tier}`, `{mult}`,
`{code}`) byte-identical to the English version — only the surrounding text
translates.

- [ ] **Step 3: Verify all 5 files stay in lockstep**

```bash
cd apps/customer && for f in en ar ru it de; do
  node -e "const j = require('./src/i18n/locales/${f}.json'); console.log('${f}:', Object.keys(j).length)"
done
```

Expected: all 5 counts increase by exactly 17 (16 `rewards.*` + 1
`tabs.rewards`) from their pre-change counts, and remain equal to each
other.

- [ ] **Step 4: Commit**

```bash
git add apps/customer/src/i18n/locales/*.json
git commit -m "feat(customer): add rewards i18n copy (en/ar/ru/it/de)"
```

---

### Task 9: Rewards tab screen + TabBar entry

**Files:**
- Create: `apps/customer/app/(tabs)/rewards.tsx`
- Modify: `apps/customer/src/components/TabBar.tsx`

**Interfaces:**
- Consumes: `db.rewards.getStatus()`, `db.rewards.listHistory()`, `db.rewards.redeem(points)` (Task 7), `useT()` (Task 8's keys), `useDirection()` from `src/lib/direction.ts` (existing RTL hook).

- [ ] **Step 1: Add the TabBar entry**

In `apps/customer/src/components/TabBar.tsx`, add `'rewards'` to the
`TabKey` union and a new entry to the `TABS` array (placing it between
`'orders'` and `'profile'`):

```ts
type TabKey = 'home' | 'browse' | 'cart' | 'orders' | 'rewards' | 'profile';

const TABS: { key: TabKey; icon: string; tKey: string; path: string }[] = [
  { key: 'home', icon: '🏠', tKey: 'tabs.home', path: '/(tabs)/home' },
  { key: 'browse', icon: '🔍', tKey: 'tabs.browse', path: '/(tabs)/browse' },
  { key: 'cart', icon: '🛒', tKey: 'tabs.cart', path: '/(tabs)/cart' },
  { key: 'orders', icon: '🧾', tKey: 'tabs.orders', path: '/(tabs)/orders' },
  { key: 'rewards', icon: '🎁', tKey: 'tabs.rewards', path: '/(tabs)/rewards' },
  { key: 'profile', icon: '👤', tKey: 'tabs.profile', path: '/(tabs)/profile' },
];
```

- [ ] **Step 2: Write the screen**

Create `apps/customer/app/(tabs)/rewards.tsx`, following `invite.tsx`'s
`ViewState` discriminated-union + `useCallback`/`useEffect` load pattern and
`profile.tsx`'s hero-header + card-list visual pattern:

```tsx
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, Text, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon } from '../../src/components/Icon';
import { colors, font, radius } from '../../src/theme';
import { useT } from '../../src/i18n';
import { useDirection } from '../../src/lib/direction';
import { tap, success } from '../../src/haptics';
import { db } from '../../src/data';
import type { RewardsHistoryEntry, RewardsStatus } from '../../src/data/types';

type ViewState =
  | { kind: 'loading' }
  | { kind: 'loaded'; status: RewardsStatus; history: RewardsHistoryEntry[] }
  | { kind: 'error' };

const TIER_NEXT: Record<RewardsStatus['tier'], { next: RewardsStatus['tier'] | null; threshold: number }> = {
  bronze: { next: 'silver', threshold: 500 },
  silver: { next: 'gold', threshold: 2000 },
  gold: { next: null, threshold: 0 },
};

export default function Rewards() {
  const insets = useSafeAreaInsets();
  const t = useT();
  const dir = useDirection();
  const [state, setState] = useState<ViewState>({ kind: 'loading' });
  const [redeeming, setRedeeming] = useState(false);

  const load = useCallback(async () => {
    setState({ kind: 'loading' });
    try {
      const [status, history] = await Promise.all([
        db.rewards.getStatus(),
        db.rewards.listHistory(20),
      ]);
      setState({ kind: 'loaded', status, history });
    } catch {
      setState({ kind: 'error' });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const redeem = async (points: number) => {
    if (state.kind !== 'loaded' || redeeming) return;
    tap();
    setRedeeming(true);
    try {
      const code = await db.rewards.redeem(points);
      success();
      Alert.alert(t('rewards.title'), t('rewards.redeemSuccess', { code }));
      await load();
    } catch (e) {
      const insufficientMsg =
        e instanceof Error && e.message === 'INSUFFICIENT_POINTS'
          ? t('rewards.redeemInsufficient')
          : t('rewards.redeemInsufficient');
      Alert.alert(t('rewards.title'), insufficientMsg);
    } finally {
      setRedeeming(false);
    }
  };

  if (state.kind === 'loading') {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }

  if (state.kind === 'error') {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center', padding: 24 }}>
        <Text style={{ color: colors.ink2 }}>{t('rewards.title')}</Text>
        <Pressable onPress={() => void load()} style={{ marginTop: 12 }}>
          <Text style={{ color: colors.accent, fontWeight: '600' }}>Retry</Text>
        </Pressable>
      </View>
    );
  }

  const { status, history } = state;
  const nextInfo = TIER_NEXT[status.tier];
  const pointsToNext = nextInfo.next ? Math.max(0, nextInfo.threshold - status.pointsRolling12mo) : 0;

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <StatusBar style="dark" />
      <ScrollView contentContainerStyle={{ paddingTop: insets.top + 12, paddingBottom: 32, paddingHorizontal: 20 }}>
        <Text style={{ fontSize: font.sizes.xxl, fontWeight: '800', color: colors.ink, textAlign: dir.text }}>
          {t('rewards.title')}
        </Text>

        <View style={{ backgroundColor: colors.white, borderRadius: radius.xl, padding: 20, marginTop: 16, borderWidth: 1, borderColor: colors.line }}>
          <Text style={{ fontSize: font.sizes.xxxl, fontWeight: '800', color: colors.accent }}>
            {t('rewards.pointsBalance', { points: status.pointsBalance })}
          </Text>
          <Text style={{ color: colors.ink2, marginTop: 4 }}>
            {t('rewards.tier', { tier: t(`rewards.tier${capitalize(status.tier)}`) })}
          </Text>
          {nextInfo.next && (
            <Text style={{ color: colors.ink3, marginTop: 8, fontSize: font.sizes.sm }}>
              {t('rewards.progressToNext', { points: pointsToNext, tier: t(`rewards.tier${capitalize(nextInfo.next)}`) })}
            </Text>
          )}
        </View>

        <Pressable
          disabled={redeeming || status.pointsBalance < 100}
          onPress={() => redeem(100)}
          style={{
            backgroundColor: status.pointsBalance >= 100 ? colors.accent : colors.line,
            borderRadius: radius.lg,
            paddingVertical: 14,
            alignItems: 'center',
            marginTop: 16,
          }}
        >
          <Text style={{ color: colors.white, fontWeight: '700' }}>{t('rewards.redeemButton')}</Text>
        </Pressable>

        <Text style={{ fontSize: font.sizes.lg, fontWeight: '700', color: colors.ink, marginTop: 28 }}>
          {t('rewards.historyTitle')}
        </Text>
        {history.length === 0 ? (
          <Text style={{ color: colors.ink3, marginTop: 8 }}>{t('rewards.historyEmpty')}</Text>
        ) : (
          history.map((h) => (
            <View
              key={h.id}
              style={{ flexDirection: dir.row, justifyContent: 'space-between', paddingVertical: 10, borderBottomWidth: 1, borderColor: colors.line }}
            >
              <Text style={{ color: colors.ink2 }}>{h.reason}</Text>
              <Text style={{ color: h.deltaPoints >= 0 ? colors.ink : colors.ink3, fontWeight: '600' }}>
                {h.deltaPoints >= 0 ? '+' : ''}{h.deltaPoints}
              </Text>
            </View>
          ))
        )}
      </ScrollView>
    </View>
  );
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
```

- [ ] **Step 3: Typecheck**

```bash
cd apps/customer && npm run typecheck
```

Expected: no errors. If `useDirection`/`haptics`/`Icon` import paths differ
from what's assumed above, correct them to match the actual exports found
in `src/lib/direction.ts`, `src/haptics.ts` (or wherever `tap`/`success`
live per Task 8's research), and `src/components/Icon.tsx`.

- [ ] **Step 4: Manual verification**

Start the customer app against mock data and navigate to the new Rewards
tab:

```bash
cd apps/customer && npm start
```

Confirm: the Rewards tab appears in the tab bar with the gift icon, tapping
it shows the mock 340-point Silver-tier balance, redeeming 100 points
succeeds and refreshes the balance to 240, and the history list renders the
two seeded mock entries.

- [ ] **Step 5: Commit**

```bash
git add apps/customer/app/\(tabs\)/rewards.tsx apps/customer/src/components/TabBar.tsx
git commit -m "feat(customer): add Rewards tab screen"
```

---

## Part C — Driver app (My Tier screen)

### Task 10: Data-fetching function

**Files:**
- Create: `apps/driver/src/loyalty.ts`

**Interfaces:**
- Consumes: RPC `my_driver_tier` (Task 5).
- Produces: `DriverTierInfo` interface, `async function getMyTier(): Promise<DriverTierInfo | null>`.

- [ ] **Step 1: Write the module**

Create `apps/driver/src/loyalty.ts`, mirroring `jobs.ts`'s plain-exported-
function style exactly (no class, no repository interface):

```ts
import { getSupabase } from './supabase';

export interface DriverTierInfo {
  tier: 'bronze' | 'silver' | 'gold';
  deliveriesRolling90d: number;
  bonusPerDeliveryEgp: number;
  firstLookSeconds: number;
  acceptanceRateSnapshot: number;
  ratingSnapshot: number;
}

/** The current driver's loyalty tier + perks, or null if not yet computed. */
export async function getMyTier(): Promise<DriverTierInfo | null> {
  const { data, error } = await getSupabase().rpc('my_driver_tier');
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) return null;
  return {
    tier: row.tier,
    deliveriesRolling90d: row.deliveries_rolling_90d,
    bonusPerDeliveryEgp: row.bonus_per_delivery_egp,
    firstLookSeconds: row.first_look_seconds,
    acceptanceRateSnapshot: row.acceptance_rate_snapshot,
    ratingSnapshot: row.rating_snapshot,
  };
}
```

- [ ] **Step 2: Typecheck**

```bash
cd apps/driver && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/driver/src/loyalty.ts
git commit -m "feat(driver): add getMyTier loyalty data-fetching function"
```

---

### Task 11: My Tier screen + navigation entry

**Files:**
- Create: `apps/driver/app/tier.tsx`
- Modify: `apps/driver/app/_layout.tsx`
- Modify: `apps/driver/app/home.tsx`

**Interfaces:**
- Consumes: `getMyTier()` (Task 9), `colors`/`spacing`/`radius`/`font` from `src/theme.ts`, `Icon` from `src/components/Icon.tsx`.

- [ ] **Step 1: Register the route**

In `apps/driver/app/_layout.tsx`, add a new `<Stack.Screen name="tier" />`
inside the existing `<Stack>` (alongside `index`, `signin`, `home`):

```tsx
<Stack.Screen name="index" />
<Stack.Screen name="signin" />
<Stack.Screen name="home" />
<Stack.Screen name="tier" />
```

- [ ] **Step 2: Write the screen**

Create `apps/driver/app/tier.tsx`, following `home.tsx`'s `useState` +
`useCallback` load + `useFocusEffect` + `ScrollView`/`RefreshControl`
pattern, reusing its local `Stat` tile shape:

```tsx
import { useCallback, useState } from 'react';
import { ActivityIndicator, RefreshControl, ScrollView, Text, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { getMyTier, type DriverTierInfo } from '../src/loyalty';
import { colors, font, radius, spacing } from '../src/theme';
import { Icon } from '../src/components/Icon';

const TIER_LABEL: Record<DriverTierInfo['tier'], string> = {
  bronze: 'Bronze',
  silver: 'Silver',
  gold: 'Gold',
};

const NEXT_THRESHOLD: Record<DriverTierInfo['tier'], number | null> = {
  bronze: 60,
  silver: 200,
  gold: null,
};

export default function Tier() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [tier, setTier] = useState<DriverTierInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    const t = await getMyTier();
    setTier(t);
    setLoading(false);
    setRefreshing(false);
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }

  const nextThreshold = tier ? NEXT_THRESHOLD[tier.tier] : null;
  const deliveriesToNext = tier && nextThreshold ? Math.max(0, nextThreshold - tier.deliveriesRolling90d) : 0;

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.bg }}
      contentContainerStyle={{ paddingTop: insets.top + spacing.lg, paddingHorizontal: spacing.lg, paddingBottom: spacing.xxxl }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); void load(); }} />}
    >
      <Pressable onPress={() => router.back()}>
        <Icon name="chevron-left" size={20} color={colors.ink} />
      </Pressable>
      <Text style={{ fontSize: font.sizes.xxl, fontWeight: '800', color: colors.ink, marginTop: spacing.md }}>
        {tier ? TIER_LABEL[tier.tier] : 'Bronze'} tier
      </Text>

      {tier && nextThreshold && (
        <Text style={{ color: colors.ink2, marginTop: spacing.xs }}>
          {deliveriesToNext} more deliveries to {TIER_LABEL[NEXT_THRESHOLD[tier.tier] ? (tier.tier === 'bronze' ? 'silver' : 'gold') : tier.tier]}
        </Text>
      )}

      <View style={{ flexDirection: 'row', gap: spacing.md, marginTop: spacing.lg }}>
        <Stat label="Deliveries (90d)" value={String(tier?.deliveriesRolling90d ?? 0)} />
        <Stat label="Bonus / delivery" value={`+${tier?.bonusPerDeliveryEgp ?? 0} EGP`} />
      </View>
      <View style={{ flexDirection: 'row', gap: spacing.md, marginTop: spacing.md }}>
        <Stat label="First look" value={tier?.firstLookSeconds ? `${tier.firstLookSeconds}s early` : 'Not yet'} />
        <Stat label="Acceptance" value={`${Math.round(tier?.acceptanceRateSnapshot ?? 100)}%`} />
      </View>
    </ScrollView>
  );
}

function Stat({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <View style={{ flex: 1, backgroundColor: colors.white, borderWidth: 1, borderColor: colors.line, borderRadius: radius.lg, padding: spacing.md }}>
      <Text style={{ fontSize: font.sizes.lg, fontWeight: '800', color: warn ? colors.amber : colors.ink }}>{value}</Text>
      <Text style={{ fontSize: font.sizes.xs, color: colors.ink2 }}>{label}</Text>
    </View>
  );
}
```

Note: this file needs a `Pressable` import from `react-native` added
alongside the others (`ActivityIndicator, RefreshControl, ScrollView, Text,
View, Pressable`).

- [ ] **Step 3: Add the entry point in home.tsx**

In `apps/driver/app/home.tsx`, near the existing rating display in the
header (the `<Icon name="star" .../>` + `{driver.rating}` line), add a
tappable element navigating to the tier screen:

```tsx
<Pressable onPress={() => router.push('/tier')} style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
  <Icon name="award" size={14} color={colors.accent} />
  <Text style={{ color: colors.accent, fontWeight: '600', fontSize: font.sizes.sm }}>My tier</Text>
</Pressable>
```

Place this adjacent to the existing rating `View` in the header JSX (verify
the exact surrounding markup in `home.tsx` before inserting, since the
research summary paraphrased its location rather than quoting exact lines).

- [ ] **Step 4: Typecheck**

```bash
cd apps/driver && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 5: Manual verification**

```bash
cd apps/driver && npm start
```

Sign in as a test driver, confirm the "My tier" link appears in the home
header, tapping it navigates to `/tier` and shows Bronze tier with zero
deliveries (before any migrations have run against seed data) or the
seeded tier once migrations 042–047 are applied to a dev project.

- [ ] **Step 6: Commit**

```bash
git add apps/driver/app/tier.tsx apps/driver/app/_layout.tsx apps/driver/app/home.tsx
git commit -m "feat(driver): add My Tier screen"
```

---

## Part D — Merchant-web dashboard (tier card)

### Task 12: Bootstrap Vitest for merchant-web

**Files:**
- Modify: `apps/merchant-web/package.json`
- Create: `apps/merchant-web/vitest.config.ts`

**Interfaces:**
- Produces: a working `npm test` script in `apps/merchant-web`.

merchant-web currently has zero test infrastructure. This task bootstraps
the minimum needed to test the new `TierStatusCard` component per the
project's 80%-coverage testing rule.

- [ ] **Step 1: Install dependencies**

```bash
cd apps/merchant-web && npm install --save-dev vitest @vitejs/plugin-react jsdom @testing-library/react @testing-library/jest-dom
```

- [ ] **Step 2: Add the Vitest config**

Create `apps/merchant-web/vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
  },
});
```

- [ ] **Step 3: Add the test script**

In `apps/merchant-web/package.json`, add to `scripts`:

```json
"test": "vitest run"
```

- [ ] **Step 4: Verify the harness runs (even with zero tests yet)**

```bash
cd apps/merchant-web && npm test
```

Expected: Vitest runs and reports "no test files found" (not an error) —
confirms the harness itself is wired correctly before Task 12 adds a real
test.

- [ ] **Step 5: Commit**

```bash
git add apps/merchant-web/package.json apps/merchant-web/vitest.config.ts apps/merchant-web/package-lock.json
git commit -m "chore(merchant-web): bootstrap vitest test runner"
```

---

### Task 13: TierStatusCard component

**Files:**
- Create: `apps/merchant-web/src/app/TierStatusCard.tsx`
- Create: `apps/merchant-web/src/app/TierStatusCard.test.tsx`
- Modify: `apps/merchant-web/src/app/page.tsx`

**Interfaces:**
- Consumes: RPC `my_restaurant_tier` (Task 5) via `createSupabaseBrowserClient()`.
- Produces: `<TierStatusCard restaurantId={string} />` component (self-fetching, matching the merchant-web convention of components owning their own `useEffect` fetch rather than always receiving props from `page.tsx`).

- [ ] **Step 1: Write the failing test**

Create `apps/merchant-web/src/app/TierStatusCard.test.tsx`:

```tsx
import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { TierStatusCard } from './TierStatusCard';

vi.mock('@/lib/supabase/client', () => ({
  createSupabaseBrowserClient: () => ({
    rpc: vi.fn().mockResolvedValue({
      data: [{ tier: 'silver', orders_rolling_90d: 62, commission_pct: 11.0, featured: false }],
      error: null,
    }),
  }),
}));

describe('TierStatusCard', () => {
  it('renders the fetched tier status', async () => {
    render(<TierStatusCard />);
    await waitFor(() => screen.getByText(/silver/i));
    expect(screen.getByText(/62/)).toBeInTheDocument();
    expect(screen.getByText(/11(\.0)?%/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd apps/merchant-web && npm test -- TierStatusCard
```

Expected: FAIL — `TierStatusCard` module not found.

- [ ] **Step 3: Write the component**

Create `apps/merchant-web/src/app/TierStatusCard.tsx`, following
`page.tsx`'s client-fetch pattern and `OrderCard.tsx`'s ad-hoc-Tailwind-card
convention (no shared `Card` component exists in this app):

```tsx
'use client';

import { useEffect, useState } from 'react';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';

interface TierStatus {
  tier: 'bronze' | 'silver' | 'gold';
  ordersRolling90d: number;
  commissionPct: number;
  featured: boolean;
}

type Phase = { state: 'loading' } | { state: 'ready'; status: TierStatus } | { state: 'error' };

const TIER_LABEL: Record<TierStatus['tier'], string> = { bronze: 'Bronze', silver: 'Silver', gold: 'Gold' };
const NEXT_THRESHOLD: Record<TierStatus['tier'], number | null> = { bronze: 50, silver: 200, gold: null };

export function TierStatusCard() {
  const [phase, setPhase] = useState<Phase>({ state: 'loading' });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const supabase = createSupabaseBrowserClient();
      const { data, error } = await supabase.rpc('my_restaurant_tier');
      if (cancelled) return;
      if (error || !data || (Array.isArray(data) && data.length === 0)) {
        setPhase({ state: 'error' });
        return;
      }
      const row = Array.isArray(data) ? data[0] : data;
      setPhase({
        state: 'ready',
        status: {
          tier: row.tier,
          ordersRolling90d: row.orders_rolling_90d,
          commissionPct: row.commission_pct,
          featured: row.featured,
        },
      });
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (phase.state === 'loading') {
    return <div className="rounded-2xl border border-line bg-white p-4 shadow-sm">Loading tier…</div>;
  }
  if (phase.state === 'error') {
    return null; // non-critical widget; fail silently rather than block the order queue
  }

  const { status } = phase;
  const nextThreshold = NEXT_THRESHOLD[status.tier];
  const ordersToNext = nextThreshold ? Math.max(0, nextThreshold - status.ordersRolling90d) : 0;

  return (
    <div className="rounded-2xl border border-line bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold text-ink">{TIER_LABEL[status.tier]} tier</span>
        {status.featured && (
          <span className="rounded-full bg-accent/10 px-3 py-1 text-xs font-semibold text-accent">Featured</span>
        )}
      </div>
      <p className="mt-2 text-xs text-ink2">
        {status.ordersRolling90d} orders (90d) · commission {status.commissionPct.toFixed(1)}%
      </p>
      {nextThreshold && (
        <p className="mt-1 text-xs text-ink3">{ordersToNext} more orders to next tier</p>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd apps/merchant-web && npm test -- TierStatusCard
```

Expected: PASS.

- [ ] **Step 5: Wire into the dashboard page**

In `apps/merchant-web/src/app/page.tsx`, import and render `TierStatusCard`
between the header and `<OrderQueue />` in the `'ready'` phase branch:

```tsx
import { TierStatusCard } from './TierStatusCard';
```

```tsx
{/* inside the ready-phase render, after the header, before <OrderQueue ... /> */}
<div className="px-6 pt-4">
  <TierStatusCard />
</div>
```

- [ ] **Step 6: Typecheck**

```bash
cd apps/merchant-web && npm run typecheck
```

Expected: no errors.

- [ ] **Step 7: Manual verification**

```bash
cd apps/merchant-web && npm run dev
```

Log in as merchant staff, confirm the tier card renders below the header
showing tier/orders/commission (or fails silently if `my_restaurant_tier`
hasn't been applied to the connected Supabase project yet).

- [ ] **Step 8: Commit**

```bash
git add apps/merchant-web/src/app/TierStatusCard.tsx apps/merchant-web/src/app/TierStatusCard.test.tsx apps/merchant-web/src/app/page.tsx
git commit -m "feat(merchant-web): add restaurant tier status card to dashboard"
```

---

## Part E — Restaurant app (apps/restaurant) tier screen

### Task 14: Tier data-fetching + screen

**Files:**
- Modify: `apps/restaurant/src/orders.ts` (add a sibling export, or create `apps/restaurant/src/loyalty.ts` — prefer the latter to keep `orders.ts` focused on orders)
- Create: `apps/restaurant/src/loyalty.ts`
- Create: `apps/restaurant/app/tier.tsx`
- Modify: `apps/restaurant/app/_layout.tsx`
- Modify: `apps/restaurant/app/home.tsx`

**Interfaces:**
- Consumes: RPC `my_restaurant_tier` (Task 5).
- Produces: `RestaurantTierInfo` interface, `async function getMyRestaurantTier(): Promise<RestaurantTierInfo | null>`.

- [ ] **Step 1: Write the data-fetching module**

Create `apps/restaurant/src/loyalty.ts`, matching `orders.ts`'s plain-
exported-function style:

```ts
import { getSupabase } from './supabase';

export interface RestaurantTierInfo {
  tier: 'bronze' | 'silver' | 'gold';
  ordersRolling90d: number;
  commissionPct: number;
  featured: boolean;
}

/** The current restaurant's loyalty tier + perks, or null if not resolved. */
export async function getMyRestaurantTier(): Promise<RestaurantTierInfo | null> {
  const { data, error } = await getSupabase().rpc('my_restaurant_tier');
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) return null;
  return {
    tier: row.tier,
    ordersRolling90d: row.orders_rolling_90d,
    commissionPct: row.commission_pct,
    featured: row.featured,
  };
}
```

- [ ] **Step 2: Register the route**

In `apps/restaurant/app/_layout.tsx`, add `<Stack.Screen name="tier" />`
alongside the existing `index`, `signin`, `home` entries.

- [ ] **Step 3: Write the screen**

Create `apps/restaurant/app/tier.tsx`, following `home.tsx`'s structure
(this app mirrors the driver app's scaffold per the restaurant-app memory,
so reuse the same `Stat`-tile + `useFocusEffect` shape as Task 10's driver
screen, substituting `getMyRestaurantTier` and the violet `accent` from
`apps/restaurant/src/theme.ts`):

```tsx
import { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { getMyRestaurantTier, type RestaurantTierInfo } from '../src/loyalty';
import { colors, font, radius, spacing } from '../src/theme';
import { Icon } from '../src/components/Icon';

const TIER_LABEL: Record<RestaurantTierInfo['tier'], string> = { bronze: 'Bronze', silver: 'Silver', gold: 'Gold' };
const NEXT_THRESHOLD: Record<RestaurantTierInfo['tier'], number | null> = { bronze: 50, silver: 200, gold: null };

export default function Tier() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [tier, setTier] = useState<RestaurantTierInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    const t = await getMyRestaurantTier();
    setTier(t);
    setLoading(false);
    setRefreshing(false);
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }

  const nextThreshold = tier ? NEXT_THRESHOLD[tier.tier] : null;
  const ordersToNext = tier && nextThreshold ? Math.max(0, nextThreshold - tier.ordersRolling90d) : 0;

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.bg }}
      contentContainerStyle={{ paddingTop: insets.top + spacing.lg, paddingHorizontal: spacing.lg, paddingBottom: spacing.xxxl }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); void load(); }} />}
    >
      <Pressable onPress={() => router.back()}>
        <Icon name="chevron-left" size={20} color={colors.ink} />
      </Pressable>
      <Text style={{ fontSize: font.sizes.xxl, fontWeight: '800', color: colors.ink, marginTop: spacing.md }}>
        {tier ? TIER_LABEL[tier.tier] : 'Bronze'} tier
      </Text>
      {tier?.featured && (
        <Text style={{ color: colors.accent, fontWeight: '600', marginTop: spacing.xs }}>Featured placement active</Text>
      )}
      {nextThreshold ? (
        <Text style={{ color: colors.ink2, marginTop: spacing.xs }}>{ordersToNext} more orders to next tier</Text>
      ) : null}

      <View style={{ flexDirection: 'row', gap: spacing.md, marginTop: spacing.lg }}>
        <Stat label="Orders (90d)" value={String(tier?.ordersRolling90d ?? 0)} />
        <Stat label="Commission" value={`${(tier?.commissionPct ?? 12).toFixed(1)}%`} />
      </View>
    </ScrollView>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ flex: 1, backgroundColor: colors.white, borderWidth: 1, borderColor: colors.line, borderRadius: radius.lg, padding: spacing.md }}>
      <Text style={{ fontSize: font.sizes.lg, fontWeight: '800', color: colors.ink }}>{value}</Text>
      <Text style={{ fontSize: font.sizes.xs, color: colors.ink2 }}>{label}</Text>
    </View>
  );
}
```

- [ ] **Step 4: Add the entry point in home.tsx**

In `apps/restaurant/app/home.tsx`, near the open/closed toggle in the
header, add a small tappable "Tier" link navigating to `router.push('/tier')`
(verify exact header markup in the file before inserting, matching the
driver app's Task 10 Step 3 approach).

- [ ] **Step 5: Typecheck**

```bash
cd apps/restaurant && npx tsc --noEmit
```

Expected: no errors (this app was previously confirmed "tsc clean" per the
restaurant-app memory — keep it that way).

- [ ] **Step 6: Commit**

```bash
git add apps/restaurant/src/loyalty.ts apps/restaurant/app/tier.tsx apps/restaurant/app/_layout.tsx apps/restaurant/app/home.tsx
git commit -m "feat(restaurant): add tier status screen"
```

---

## Part F — Rollout

### Task 15: Apply migrations to a dev/staging Supabase project and smoke-test

**Files:** none (operational task)

- [ ] **Step 1: Apply migrations 042–047 to a non-production Supabase project**

```bash
supabase db push --project-ref <dev-project-ref>
```

Expected: all 5 migrations apply cleanly in order.

- [ ] **Step 2: Run `get_advisors` (security + performance) against the dev project**

Confirm no new advisor warnings are introduced by the loyalty tables/
functions (in particular: no "RLS enabled, no policy" false-flag on tables
that intentionally have zero client policies — these should already be
suppressed by the same pattern used for `driver_loyalty`/`restaurant_loyalty`
matching `promo_codes`/`referrals`, but verify).

- [ ] **Step 3: Seed one test order per side through to `delivered` and confirm ledger rows + tier fields populate**

Manually place a test order via the customer app (or a direct `place_order`
RPC call) against the dev project, advance it to `delivered`, then run
`select * from loyalty_points_ledger order by created_at desc limit 10;`
and confirm 3 new rows (customer/driver/restaurant). Manually invoke
`select public.loyalty_tier_sweep();` and confirm `customer_loyalty`,
`driver_loyalty`, `restaurant_loyalty` rows exist/update accordingly.

- [ ] **Step 4: Regenerate TypeScript types**

```bash
npm run db:types
```

Expected: `packages/db-types/database.types.ts` picks up the 5 new tables
and updated `platform_settings`/`promo_codes` constraints without manual
edits.

- [ ] **Step 5: Commit the regenerated types**

```bash
git add packages/db-types/database.types.ts
git commit -m "chore: regenerate db types for loyalty tables"
```

This task is intentionally left for a human/owner-gated step (applying to a
real Supabase project requires credentials this plan does not assume access
to) — subsequent tasks' local-SQL-validation steps (Tasks 1–6) are what
must pass before this rollout step is attempted.

---

## Self-Review Notes

**Spec coverage:** every section of the design spec maps to a task —
shared ledger (Task 1), tier tables (Task 2), earn/clawback (Task 3),
nightly sweep + auto-applied commission/featured (Task 4), redemption RPC
(Task 5), Gold-tier driver first-look dispatch window (Task 6 — this was
missing from the first draft of this plan despite being an explicit spec
requirement; added on self-review), customer Rewards tab (Tasks 7–9),
driver My Tier screen (Tasks 10–11), restaurant tier card on both
merchant-web (Tasks 12–13) and the native restaurant app (Task 14),
rollout (Task 15).

**Type consistency:** `RewardsStatus`/`DriverTierInfo`/`RestaurantTierInfo`
field names (`pointsBalance`, `bonusPerDeliveryEgp`, `commissionPct`, etc.)
are used identically between each app's data-fetching module and its screen
component. The SQL RPC return-column names (`snake_case`) are mapped once
per app, at the repository/data-fetching boundary, never leaking
snake_case into component code.

**Placeholder scan:** no TBD/TODO markers. Task 15 (prod rollout) is
explicitly marked as an operational/owner-gated step rather than a vague
placeholder — its prerequisite (all local SQL validation passing) is
concrete and testable without prod credentials.

**Gotcha caught during self-review:** the first draft of Task 4's sweep
computed driver delivery volume from `order_assignments.status =
'completed'`, but a grep across every migration confirmed nothing in this
codebase ever writes that status value (`driver_respond` only ever sets
`'accepted'`/`'rejected'` — see `011_rpcs.sql`). This would have made
`deliveries_rolling_90d` permanently zero for every driver, silently
capping every driver at Bronze forever. Fixed to count from
`orders.status = 'delivered'` joined on `assigned_driver_id`, which is the
column that's actually maintained.
