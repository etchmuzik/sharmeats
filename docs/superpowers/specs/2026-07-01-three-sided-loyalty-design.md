# Three-Sided Loyalty System — Design

Date: 2026-07-01
Status: Approved for planning

## Purpose

Build one loyalty system that covers all three sides of Sharm Eats: customers
(repeat-order incentive), drivers (retention/reliability incentive), and
restaurants (volume/retention incentive). All three share one architecture —
a points ledger — rather than three independent bolt-ons, because the
platform already has two precedents for this shape of feature (`promo_codes`/
`promo_redemptions` in migration 019, and the referral reward loop in
migration 026) and a third parallel system would triple the audit/reversal
logic for no benefit.

## Non-goals

- No refund/dispute workflow is being built here. `orders.status` has no
  `refunded` state today (`002_app_schema.sql`), only `cancelled`. Clawback
  hooks into whatever reversal path exists now; a dedicated refund flow is
  out of scope.
- No changes to core dispatch scoring (`nearest_drivers`) or auto-accept
  logic. Driver tier affects only a first-look offer delay, never who
  ultimately gets matched.
- No wallet/stored-value system. Customer points convert to one-time promo
  codes, reusing the existing discount engine — no new balance-holds-cash
  liability is introduced.

## Architecture

One shared, append-only ledger table drives all three programs:

```
loyalty_points_ledger
  id              uuid pk
  subject_type    text check in ('customer','driver','restaurant')
  subject_id      uuid   -- users.id / drivers.id / restaurants.id
  delta_points    int    -- positive (earn/bonus) or negative (redeem/clawback)
  reason          text check in ('order_earn','redeem','clawback','tier_bonus')
  ref_order_id    uuid references orders(id) on delete set null
  created_at      timestamptz not null default now()
```

RLS enabled, no client policies — identical lockdown to `promo_redemptions`.
All reads/writes go through `SECURITY DEFINER` functions.

Each side has a derived tier table, recomputed from the ledger by a nightly
`pg_cron` sweep (same mechanism already used by `auto_dispatch`'s sweep):

```
customer_loyalty
  user_id               uuid pk references users(id)
  tier                  text ('bronze'|'silver'|'gold')
  points_balance        int   -- spendable, does not expire on its own
  points_rolling_12mo   int   -- drives tier; trailing 12-month window
  updated_at            timestamptz

driver_loyalty
  driver_id                uuid pk references drivers(id)
  tier                     text ('bronze'|'silver'|'gold')
  deliveries_rolling_90d   int
  acceptance_rate_snapshot numeric
  rating_snapshot          numeric
  bonus_per_delivery_egp   int
  first_look_seconds       int   -- 0 for bronze
  updated_at               timestamptz

restaurant_loyalty
  restaurant_id            uuid pk references restaurants(id)
  tier                     text ('bronze'|'silver'|'gold')
  orders_rolling_90d       int
  commission_discount_pct  numeric  -- subtracted from restaurants.commission_pct
  updated_at               timestamptz
```

Tunable config (points-per-EGP rate, tier thresholds, bonus amounts,
first-look seconds, commission discounts) lives in the existing
`platform_settings` table, matching the referral system's pattern of
no-deploy-required tuning.

## Customer program

- **Earn:** on `orders.status → 'delivered'`, a trigger inserts a ledger row:
  `floor(subtotal_egp / points_per_egp) * tier_multiplier`.
- **Tiers:** Bronze (default) / Silver / Gold, computed from
  `points_rolling_12mo` (trailing 12 months — a tourist's one-week order
  burst doesn't lock them into permanent Gold; an active resident's tier
  reflects sustained activity, not a calendar-year cliff).
- **Tier perks:** points-earn multiplier (Silver 1.25x, Gold 1.5x), free
  delivery above a monthly order-count threshold at Silver+, and soft perks
  at Gold (priority support flag, early access to new restaurants/promos —
  surfaced, not deeply mechanized, in phase one).
- **Redemption:** `redeem_points(p_points int) returns text` (`SECURITY
  DEFINER`) validates balance, debits the ledger, mints a one-time
  `promo_codes` row (`LOY-XXXXXX`, fixed-kind, `per_user_limit = 1`) exactly
  like the referral reward path (`REF-XXXXXX` in migration 026). Checkout
  auto-suggests "You have enough points for X EGP off" (computed client-side
  from balance) as a one-tap apply into the existing promo box, alongside
  manual code entry.
- **Surface:** new "Rewards" tab in the customer app — balance, tier
  progress bar, perk list, redeem action, ledger history.

## Driver program

- **Earn:** on `orders.status → 'delivered'`, a ledger row credits the
  assigned driver (1 point per delivery, or a small weighting if useful
  later — kept simple in phase one).
- **Tiers:** computed from `deliveries_rolling_90d`, but **gated by a
  quality floor** — a driver only advances to Silver/Gold if
  `acceptance_rate_snapshot` and `rating_snapshot` are also above configured
  minimums. A high-volume driver with poor acceptance/rating stays capped at
  Bronze regardless of delivery count.
- **Tier perks:**
  - `bonus_per_delivery_egp` — added to `driver_earnings.bonus` on every
    completed delivery (reuses the existing per-delivery earnings row;
    no new payout batch mechanism needed).
  - `first_look_seconds` — Gold-tier drivers in a zone receive a new order
    offer this many seconds before it broadcasts platform-wide. Implemented
    as a delay in the existing offer-creation path (`order_assignments`
    creation / auto-dispatch sweep), **not** a change to `nearest_drivers`
    distance scoring — core dispatch fairness is untouched.
- **Surface:** new "My Tier" screen in the driver app — tier badge, progress
  to next tier (with the quality-gate requirement shown explicitly if that's
  the blocker), current bonus rate, first-look eligibility.

## Restaurant program

- **Earn:** on `orders.status → 'delivered'`, a ledger row credits the
  restaurant (1 point per order — this program only needs order *count*,
  not a points economy, since restaurants don't redeem points for anything;
  the ledger row exists purely for audit/clawback consistency with the other
  two sides).
- **Tiers:** computed from `orders_rolling_90d` (order count, not GMV — so a
  small high-volume/low-ticket restaurant competes on equal footing with a
  large one, and the metric is simple to explain to merchants).
- **Tier perks:**
  - `commission_discount_pct` auto-applied: the nightly sweep recalculates
    each restaurant's effective `restaurants.commission_pct` from its base
    rate minus the tier discount — fully automated, no admin approval step,
    consistent with how the other two sides work.
  - Gold tier sets `restaurants.featured = true` (existing column, already
    read by the customer app's restaurant list).
- **Surface:** tier card on the merchant web dashboard — current tier,
  effective commission rate, orders-to-next-tier, featured-placement status.

## Clawback / reversal

If a `delivered` order's status is later changed away from `delivered` (the
only reversal path today, via `cancelled` — no explicit `refunded` state
exists), a trigger inserts negative ledger rows for all three sides tied to
that `ref_order_id`, mirroring the earn amounts. The next nightly sweep
re-derives tier from the corrected rolling window, so a clawback can demote
a tier exactly as an earn can promote one. This prevents the
order-then-reverse abuse path the same way the existing systems guard
against equivalent gaming (e.g. `has_completed_order` gating referral
self-abuse in migration 026).

## Security model

Every new table follows the established pattern: RLS enabled, no permissive
client policies, all reads via narrow `SECURITY DEFINER` RPCs
(`my_loyalty_status()`, `redeem_points()`), all writes via triggers or the
nightly sweep — mirroring `promo_codes`/`promo_redemptions` and `referrals`
exactly. No new client-writable surface is introduced.

## Testing

- SQL: dry-run the earn/clawback/sweep logic against a local shimmed
  Postgres (see `sharmeats-local-sql-validation` memory) before touching
  prod — same validation approach used for prior migrations.
- Unit/integration: earn-on-delivery, clawback-on-reversal, tier
  recompute at each threshold, quality-gate blocking driver tier
  advancement, redemption debit + promo code mint, commission
  auto-apply — one test per invariant, 80%+ coverage per the project's
  testing rule.
- Manual: exercise the three new screens (Rewards tab, My Tier, merchant
  tier card) against a seeded account at each tier.

## Open items deferred to implementation planning

- Exact point-per-EGP rate and tier thresholds (numbers to be set as
  `platform_settings` defaults, tunable post-launch without a deploy).
- Whether restaurant tier ever needs a client-visible history (currently
  scoped to just the current tier card, not a ledger view — restaurants
  don't spend points, so a detailed ledger view has lower value than for
  customers/drivers).
