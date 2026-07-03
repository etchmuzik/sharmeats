# Sharm Eats — Platform Gap Analysis

_Pre-scale technical audit · prepared before increasing marketing spend_

Sharm Eats is a live, three-sided food-delivery platform for Sharm El Sheikh: a
customer app, a driver app, a restaurant (kitchen) app, and a merchant/admin web
console, all on a Supabase backend with 61 migrations. The **front of house is
genuinely done and running** — ordering, real-time tracking, automated dispatch
(auto-accept / auto-advance / dispatch sweeps), a three-sided loyalty engine,
referrals, and full localization across five languages (EN/AR/RU/IT/DE) with RTL.
What this audit found is that the **back-of-house money-and-operations layer is
not yet built**: there is no commission-billing pipeline, no refund or
goodwill-credit primitive, no settlement/payout system, no fraud caps on
cash-on-delivery, and no fulfillment mechanism behind the "automatic late-delivery
credit" the app already promises customers. **None of this blocks a small,
hand-reconciled pilot** — a founder can settle 20 restaurants on a spreadsheet and
issue credits by hand. It blocks _scale_: the moment order volume, restaurant
count, or marketing spend rises past what one person can reconcile manually, the
missing rails become the constraint.

This is a normal and healthy shape for a solo-founder pre-seed product. The
front-end that wins the first customer was built first and built well; the
financial back-end that a controlled pilot can defer was scoped, not skipped. This
document exists precisely because that boundary was drawn deliberately — it is the
"we know exactly what is left, why, and in what order" appendix. Every gap below
was adversarially verified against the codebase; nothing here is speculative
hand-waving. It serves two readers at once: the founder, as a build roadmap; and a
technical due-diligence reviewer, as evidence of engineering rigor.

---

## Executive summary

**42 gaps were adversarially verified** (each confirmed against source, with the
partial/existing infrastructure documented). A further **28 lower-priority
"scale-moat" items** were flagged but not deep-verified and are listed as a backlog
to re-confirm, not a to-do list.

### By priority (verified gaps)

| Priority | Count | Meaning |
|---|---:|---|
| **P0 — launch-critical** | 13 | Blocks safe scale / creates live liability; fix before real spend |
| **P1 — revenue-engine** | 29 | The systems that turn a working app into a profitable business |
| **P2 — scale-moat (unverified)** | 28 | Compounding advantages; flagged, to be re-confirmed later |

### By dimension (42 verified gaps)

| Dimension | P0 | P1 | Total | What it governs |
|---|---:|---:|---:|---|
| **Monetization** | 1 | 4 | 5 | The revenue lines: commission, fees, ads, funded promos |
| **Ops-support** | 3 | 6 | 9 | Running a pilot: support console, refunds, settlement, alerting |
| **Retention-growth** | 2 | 6 | 8 | The growth loops: waitlist, deep links, campaigns, analytics, SEO |
| **Compliance-finance** | 2 | 5 | 7 | The ledger, VAT, KYC, e-invoicing, payout system |
| **Marketplace-liquidity** | 3 | 6 | 9 | ETA honesty, radius gating, dispatch escalation, batching |
| **Reliability-scale** | 2 | 2 | 4 | Error alerting, OTA gate, CI/CD, backups |
| **Total** | **13** | **29** | **42** | |

Effort distribution across the 42: **13 small · 26 medium · 3 large**. The majority
of the launch-critical work is small-to-medium, and much of it reuses
infrastructure that already exists (see the root-cause box below).

### The two things bleeding today

> **(a) The unfulfillable auto-late-credit promise is a live consumer-protection
> liability.** The customer app publicly states, at checkout and in the help FAQ,
> that _"if your order arrives more than 15 minutes late, we automatically credit
> 10% of the order back to your Sharm Eats wallet — no support ticket needed."_
> There is no wallet, no late-detection job, and no credit issuance anywhere
> server-side. Every late order is a written promise silently broken. An
> unfulfillable automatic-compensation claim is deceptive advertising under
> **Egypt's Consumer Protection Law 181/2018**, and it targets the exact tourist
> segment the on-time promise was meant to win. This bleeds trust on order one and
> legal exposure at scale.
>
> **(b) COD + guest checkout + zero order caps is an open fraud surface.** Cash-on-
> delivery is the launch payment method, checkout is available to guest
> (anonymous-auth) users, and there is no per-user, per-guest, or new-user order
> cap and not even a flag to block a repeat offender. Anyone can place unlimited
> fake orders that burn real restaurant food cost and driver time, and keep doing
> it after ten no-shows. In COD markets fake/no-show orders run 1–3% and spike the
> moment a platform is found to be defenseless.

Neither requires a heavy build. Both are addressed in **Phase 0** below, before any
marketing spend.

---

## Root-cause insight: one foundation unblocks five P0s

> **Five of the thirteen P0 gaps share a single root cause: the app makes financial
> promises with no ledger or credit primitive behind them.**
>
> The platform tells restaurants it collects **12% commission**, tells customers it
> will **automatically credit them 10% for late orders**, and carries a `refunded`
> payment status in its schema — but there is no per-order record of the commission
> owed, no wallet or credit instrument, and no refund tool. Each promise was wired
> to a display, never to money.
>
> The five clustered P0s are:
>
> 1. **Commission settlement pipeline** (money is never computed or collected)
> 2. **Per-order commission snapshot** (platform revenue is never recorded)
> 3. **Refund / goodwill-credit workflow** (no credit primitive; agent has no tool)
> 4. **SLA late-credit fulfillment engine** (the advertised promise has no granting mechanism)
> 5. **Advertised auto late-delivery credit has no fulfillment mechanism** (the compliance face of #4)
>
> A **single foundation — a customer/merchant credit-ledger plus a per-order
> commission snapshot** — unblocks all five at once, and beyond them: restaurant
> payout statements, honest revenue reporting, VAT-on-commission, and every future
> merchant-side fee (ads, activation). The commission snapshot in particular is
> **urgent and cheap**: `restaurants.commission_pct` is a _live, mutable_ column
> that the loyalty tier sweep rewrites in place (migrations 045/051), so the
> effective rate at the time of any historic order is already unrecoverable. **Every
> day without a per-order snapshot permanently destroys billing data.**
>
> **Recommendation: build the credit-ledger + commission-snapshot foundation
> first.** It is the highest-leverage engineering investment on this list — one
> medium build that converts five separate liabilities into a working money engine.

---

## P0 — Launch-critical (13)

These block safe scaling or create live liability. Grouped by dimension; all 13 are
listed.

### Monetization

### Commission settlement pipeline (rate exists, money is never computed or collected)
- **Dimension:** monetization · **Effort:** medium
- **Why it matters:** Commission is the platform's primary revenue line — 12% of
  GMV (e.g. 3,000 orders/mo at ~300 EGP AOV ≈ **~108k EGP/mo**). Today there is no
  per-order commission amount, no merchant statement, no payables/receivables, and
  no admin finance view, so the 12% cannot be invoiced, collected, or audited.
  Worse, the loyalty sweep mutates `restaurants.commission_pct` in place (migs
  045/051), so the applicable rate for past orders is unrecoverable — every day
  without a per-order snapshot destroys billing data. This also blocks charging any
  future merchant-side fee (ads, activation), since no billing rails exist at all.
- **What partially exists:** `restaurants.commission_pct` rate column (12% default)
  exists and is surfaced read-only in the merchant portal; driver-side COD
  reconciliation (`driver_earnings.cod_collected` netting) exists for drivers only.

### Ops-support

### Refund / goodwill-credit workflow (no wallet or credit primitive, agent has no refund tool)
- **Dimension:** ops-support · **Effort:** medium
- **Why it matters:** COD is the launch payment method; once cash is collected,
  making a customer whole (wrong order, missing item, quality complaint) requires a
  credit/wallet primitive or a driver-returns-cash flow — neither exists.
  `payment_status` `'refunded'` is an orphaned enum value nothing ever sets. Every
  complaint becomes an unresolvable WhatsApp thread or an off-books cash decision;
  in food delivery ~2–5% of orders need remediation, so at even 200 orders/day that
  is 4–10 unresolvable cases daily — each a churn event in a small tourist market
  that lives on repeat business and word of mouth.
- **What partially exists:** `payment_status` enum includes `'refunded'`;
  `order_items` snapshots line items specifically to enable line-level refunds
  someday; the referral engine (026) mints one-time fixed-value promo codes — a
  proven pattern that could be reused as the credit instrument.

### SLA late-credit fulfillment engine — the in-product promise has no granting mechanism
- **Dimension:** ops-support · **Effort:** medium
- **Why it matters:** The customer app publicly promises: _"If your order arrives
  more than 15 minutes late, we automatically credit 10% of the order back to your
  Sharm Eats wallet — no support ticket needed"_ (help FAQ), and shows
  `order.slaLine` on every order. There is no wallet, no late-detection job, and no
  credit issuance server-side. First late order = broken advertised promise; at
  scale it is systematic false advertising in a market where the on-time promise is
  the differentiation strategy.
- **What partially exists:** Orders carry `eta_at`, and `order_status_events`
  records delivery timestamps, so lateness is computable; the promo-code-mint
  pattern (referrals) is a ready-made credit instrument; `pg_cron` sweep
  scaffolding is well-established to copy.

### Support console in admin web: order lookup, customer 360, and status timeline
- **Dimension:** ops-support · **Effort:** medium
- **Why it matters:** An agent answering _"where is order #SE-ABC123?"_ has no UI to
  find that order: the admin dashboard query explicitly excludes terminal orders
  (`.not('status','in','(delivered,cancelled,rejected)')`), there is no search by
  short code or phone, no order-detail page, no customer profile (past orders,
  loyalty balance, addresses), and no view of `order_status_events` history. Every
  support interaction requires the founder in the Supabase SQL editor — throughput
  is capped at roughly one person and does not scale past a handful of orders/day.
- **What partially exists:** The dispatch board proves the realtime + RLS plumbing
  works for admins; `order_status_events` and rider/address snapshots on orders
  already contain everything a detail view needs — this is pure UI work over
  existing data.

### Retention-growth

### Waitlist email capture is broken end-to-end (missing API route on a static export)
- **Dimension:** retention-growth · **Effort:** small
- **Why it matters:** The landing page is the only pre-install demand-capture
  surface, localized in five languages, collecting email + WhatsApp — but every
  submission fails. All paid or organic traffic to sharmeats.online converts to
  **zero captured leads**; at even 1,000 visitors/month and a 5% signup rate that is
  ~50 lost contacts/month who could become first orders at launch. It also silently
  poisons trust — the user sees an error after typing their email.
- **What partially exists:** `waitlist` table with RLS exists (001); the form UI is
  complete and localized; the insert just has no server endpoint. Fix = point the
  form directly at Supabase with the anon key + insert-only RLS, or restore the
  route on a dynamic host.

### Deep linking half-wired: no universal/app links, no push-tap routing, referral shares land on a generic homepage
- **Dimension:** retention-growth · **Effort:** small
- **Why it matters:** Every growth loop terminates in friction. The AASA advertises
  `/order/*`, `/restaurant/*`, `/item/*`, `/track/*`, but no app can open them: iOS
  lacks `associatedDomains`, Android lacks `intentFilters`, there is no
  `assetlinks.json`, and the static landing has no such web pages, so shared links
  404. Referral shares (the EGP 50/50 engine) send a bare homepage URL plus a code
  the friend must re-type at signup — typed-code redemption converts 2–3x worse than
  link-click attribution. Order-status pushes that don't route to the order screen
  waste the platform's highest-CTR re-engagement channel.
- **What partially exists:** Custom scheme `sharmeats` is set; the AASA file is
  published with correct paths and content-type handling; expo-router gives every
  screen a URL, so in-app routing is one config away.

### Compliance-finance

### Advertised auto late-delivery credit has no fulfillment mechanism
- **Dimension:** compliance-finance · **Effort:** medium
- **Why it matters:** The customer app promises at checkout: _"If we miss by 15
  minutes, {credit} is automatically credited to you — no support call needed"_
  (`order.slaLine`). An unfulfillable automatic-compensation promise is deceptive
  advertising under **Egypt's Consumer Protection Law 181/2018** (the CPA does
  pursue misleading claims), an app-review risk, and a trust-killer for the exact
  tourist segment the platform courts. Every late order at launch silently breaches
  a written promise. (This is the compliance face of the SLA late-credit engine
  above — same fix, viewed as legal exposure rather than ops capability.)
- **What partially exists:** SLA display (`sla_minutes`, `eta_at`, countdown UI) and
  the promo-code minting machinery (migs 019/026/047/058) a credit could reuse.

### Per-order commission snapshot (platform revenue is never recorded)
- **Dimension:** compliance-finance · **Effort:** small
- **Why it matters:** The platform's entire revenue (12–18% commission) is never
  computed or stored per order. `restaurants.commission_pct` is a live, mutable
  column the loyalty tier sweep rewrites in place (migs 045/051), so the effective
  rate for any historic order is unrecoverable. Weekly payouts, revenue reporting,
  VAT-on-commission, and future ETA invoices all derive from this number — computing
  them retroactively off today's rate silently misstates every prior week. **This is
  the single cheapest fix protecting the whole money engine** and it is a small
  effort.
- **What partially exists:** `restaurants.commission_pct` exists (mig 006, LOI 12%)
  and loyalty adjusts it; the rate just isn't stamped onto orders.

### Marketplace-liquidity

### Honest customer ETA model (dispatch + travel time) and on-time-promise liability control
- **Dimension:** marketplace-liquidity · **Effort:** medium
- **Why it matters:** `eta_at` is set once at placement to `now() + prep_time_high`
  and `sla_minutes = prep_time_high` — zero allowance for the 20s dispatch sweep,
  45s offer windows (potentially several, serially), or driver travel time. The
  on-time promise auto-issues late credits against this number, so every order that
  waits for a driver or travels more than ~0 minutes trends late: a systematic
  credit/refund leak plus broken trust with tourists who planned around the promise.
  At even 30% late-credit incidence the promise becomes a tax on every delivery —
  the most direct money leak in the liquidity dimension.
- **What partially exists:** `eta_at` column and customer countdown UI exist;
  `order_status_events` timestamps exist to measure actual stage durations;
  `dropoff_geo` and restaurant geo are both stored, so a haversine travel term is
  computable today.

### Delivery radius / feasibility gating (restaurant-to-dropoff distance check)
- **Dimension:** marketplace-liquidity · **Effort:** medium
- **Why it matters:** Nothing prevents ordering from any active restaurant to any
  address city-wide. The flat 20–40 EGP zone fee is priced off the _dropoff_ zone
  only — the restaurant's location never enters the fee or any validation — so a
  Nabq→Old Market order (~25–30km round trip) is accepted at 40 EGP with a
  prep-time-only ETA. These orders are unit-economic losers, tie up a
  one-order-at-a-time driver for an hour, and produce the platform's worst delivery
  experiences. In a thin-fleet launch market, a handful per dinner rush can collapse
  zone-level liquidity.
- **What partially exists:** PostGIS is installed (005), both restaurant and address
  geo are stored, and `delivery_fee_rules` has dormant `per_km_fee`/`min_fee`
  columns explicitly designed for distance pricing — the schema is ready, the check
  just doesn't exist.

### Unfilled-order escalation (no-driver alerting, radius widening, customer comms)
- **Dimension:** marketplace-liquidity · **Effort:** small
- **Why it matters:** When `auto_assign_order` finds nobody in the 5km radius,
  `dispatch_sweep` silently retries every 20s forever. No admin push/alert, no
  automatic radius widening, no customer notification that their food is cooked but
  stranded. In a launch fleet of a handful of drivers this WILL happen nightly, and
  each silent stall is a churned tourist plus wasted food. Detection currently
  depends on an admin happening to be watching the dispatch board.
- **What partially exists:** The admin dispatch board shows a live "Needs dispatch"
  count with manual click-assign — a passive escape hatch, but only if someone is
  staring at it.

### Reliability-scale

### No server-side error tracking or alerting — dispatch can die silently
- **Dimension:** reliability-scale · **Effort:** medium
- **Why it matters:** Auto-dispatch (`pg_cron dispatch_sweep` every 20s) is the
  revenue engine; if the cron job starts failing, orders sit undispatched
  platform-wide and nobody is paged. Edge functions (expo-push, paymob-webhook,
  delete-account) only `console.error` into Supabase logs no one watches. During a
  marketing-driven demand spike, hours of silent dispatch failure = 100% order
  fulfillment outage plus refund/churn costs; a single missed dinner rush in an
  11-zone resort market is thousands of EGP and permanent restaurant-partner
  distrust.
- **What partially exists:** `docs/LAUNCH-MONITOR.md` has well-designed heartbeat SQL
  (dispatch sweep success counts, kill switch); `auto_assign_order` raises WARNINGs
  into postgres logs. All manual-pull, zero push/alerting.

### No OTA updates, runtimeVersion, or force-update gate in the store binaries
- **Dimension:** reliability-scale · **Effort:** medium
- **Why it matters:** The v1.0.0 binaries about to reach users have no remote lever:
  a crashing bug or broken checkout discovered after launch requires a full store
  review cycle (1–3 days Apple, hours-to-days Google) during which every install is
  broken and marketing spend burns against a dead app. A version-gate must ship _in_
  the first binary to ever work — it cannot be retrofitted to clients already in the
  field, which is what makes this launch-critical rather than deferrable.
- **What partially exists:** `expo-updates` dependency installed (customer only,
  unconfigured); `platform_settings` table exists and would be a natural home for a
  `min_app_version` key.

---

## P1 — Revenue-engine (29)

The systems that turn a working app into a profitable, measurable business.
Concise: dimension · effort · one-line why. Grouped by dimension.

### Monetization (4)

- **Order-level customer service fee** (config key exists, wired to nothing) —
  monetization · small · A 5–10 EGP per-order fee is near-pure margin and standard
  in Egypt (Talabat charges one); at 3,000 orders/mo that is 15–30k EGP/mo of
  incremental revenue — the cheapest revenue lever in the codebase, currently dead
  config.
- **Sellable sponsored / featured placement** (the shelf exists, the ads product
  does not) — monetization · medium · Sponsored listings are the highest-margin
  marketplace lever (1–3% of GMV at near-100% margin at maturity); the featured
  shelf already renders but can only be _earned_ via loyalty Gold tier, never sold —
  no sponsored table, no billing, no paid-ranking concept.
- **Merchant-funded promotions / campaign attribution** — monetization · medium ·
  Every promo discount today hits the platform's own P&L; `promo_codes` has no
  `funded_by` or restaurant scoping, so the platform cannot sell "run a 20%-off
  campaign, you fund it" — the standard way delivery platforms make promos
  revenue-neutral.
- **Small-order fee** (below-minimum baskets are hard-blocked instead of monetized)
  — monetization · small · `place_order` raises `BELOW_MIN_ORDER` and loses the sale;
  a 10–15 EGP small-order fee converts that friction into captured revenue.
  Category data puts 7–15% of checkout attempts under minimums — meaningful volume
  in a tourist market of single-person snack orders.

### Ops-support (6)

- **Driver end-of-day cash settlement** (payout batches, cash-in confirmation, COD
  debt cap) — ops-support · medium · Per-order COD marking is enforced but cash the
  driver owes only accumulates; no close-out workflow, no settlement ledger, no cap
  stopping new COD dispatch to a driver already carrying 3,000 EGP. Cash leakage is
  the classic failure mode of COD delivery ops.
- **COD fraud controls** (customer block/no-show blacklist, new-user & guest order
  caps, device fingerprinting) — ops-support · medium · Guest checkout + COD + zero
  caps means anyone can place unlimited fake orders with no recourse — not even a
  flag to block a repeat offender. Promo abuse is well-covered; the core fake-order
  vector is not. _(Caps portion is pulled forward to Phase 0.)_
- **Dispute / complaint case tracking** (ticketing over the WhatsApp channel) —
  ops-support · medium · Support is WhatsApp deep links with zero case state: no
  record of open complaints, ownership, promises made, or repeat-complainer history;
  double-compensation becomes possible and complaint-rate-by-restaurant/driver — the
  key supply-curation signal — is invisible. (Support number is still a placeholder.)
- **Admin order cancellation UI with reason-code taxonomy** — ops-support · small ·
  Cancelling mid-order (restaurant closed, driver crash, unreachable customer)
  requires the founder calling the RPC by hand with free-text reasons, so
  cancellation-cause reporting never aggregates — the core input for fixing unit
  economics. Server authorization is already done; needs a button + reason picker.
- **Ops SLA dashboard + automated late/stuck-order alerting** — ops-support · medium
  · The pipeline is automated, so failures are silent-by-design: an order stuck at
  "ready" with no drivers, or a failing sweep, is found only if someone watches the
  board. Needs stuck-order aging surfaced plus a push/WhatsApp alert when thresholds
  trip — all raw signals already exist.
- **Restaurant payout statements / commission invoices** — ops-support · medium ·
  Restaurants settle via `commission_pct` but see no statement, invoice, or earnings
  screen for what they owe or are owed; without weekly statements every settlement
  is a manual spreadsheet negotiation that caps how many restaurants one ops person
  can manage. (Unblocked by the commission-snapshot foundation.)

### Retention-growth (6)

- **Conversion-funnel analytics** (12 events, customer app only, no coverage on 4 of
  5 surfaces) — retention-growth · small · No `add_to_cart`, `menu_item_viewed`,
  `signup_completed`, `order_delivered`, or screen tracking, so the core funnel has
  holes at both ends; driver/restaurant/web surfaces emit zero events. Every
  downstream growth gap depends on this instrumentation existing first.
- **No marketing push-campaign tooling** (segmented sends, scheduling, admin
  composer) — retention-growth · medium · Push is the only owned re-engagement
  channel and the token audience is already collected, but there is no composer or
  segmentation (by zone, last-order date, tier, locale). Campaign push typically
  drives 10–25% of weekly orders for delivery apps.
- **No abandoned-cart / abandoned-checkout recovery** — retention-growth · medium ·
  `checkout_opened` is tracked but nothing acts on it; carts live only in device
  storage. Abandonment runs 60–80%; recovering even 5–10% with a 30–60min reminder
  push is among the highest-ROI retention automations, and the push pipe + promo
  engine to fund it already exist.
- **No app-store review prompt (`StoreReview`) at the post-delivery happy moment** —
  retention-growth · small · The app already detects the perfect trigger (completed
  delivery → 5-star in-app rating) but never converts goodwill into a store review.
  Going from a handful of ratings to hundreds moves listing conversion 20–30% in an
  app-store-search-dominated tourist market.
- **No win-back / lapsed-customer automation** — retention-growth · medium · Sharm's
  audience is bimodal (tourists on a 1–2 week lifecycle, residents on a weekly
  cadence) and no automation detects either lapse. A "lapsed 7/14/30 days → push with
  minted promo" loop is the standard second-order engine; owner-bound codes (058)
  make it fraud-safe.
- **SEO surface near zero** (no robots.txt, no sitemap, no restaurant pages, EN-only
  metadata despite 5 locales) — retention-growth · medium · Tourists Google "food
  delivery Sharm El Sheikh" in five languages; the landing is a single `lang="en"`
  page with client-only locale switching, no hreflang/JSON-LD/sitemap and zero
  per-restaurant pages, so it can rank for one query in one language. Restaurant
  slugs already exist to generate static pages from.

### Compliance-finance (5)

- **Restaurant settlement / payout system** (statements, bank details, payout runs)
  — compliance-finance · large · The signed LOI commits to weekly Sunday bank-transfer
  payouts plus an EGP 1,000 month-1 minimum-order guarantee, yet there is no table of
  what the platform owes each restaurant, no bank/IBAN fields, no statement, and no
  guarantee modeling. With COD dominant, restaurants are paid on trust from week one.
- **VAT modeling** on orders, delivery fees, and platform commission —
  compliance-finance · medium · Egypt's standard VAT is 14% and commission is a
  taxable service, but tax is hardcoded to zero everywhere. Once VAT-registered
  (mandatory at EGP 500k turnover ≈ 3–4 months of modest GMV), commission invoices
  must add VAT; retrofitting after thousands of `tax_egp=0` orders means restating
  the books, and unbilled VAT comes out of margin.
- **Restaurant onboarding KYC** (commercial registration, tax card, food license
  capture) — compliance-finance · medium · Restaurants onboard via a non-binding LOI
  and the platform captures zero legal identity — no commercial-registration number,
  no tax card (بطاقة ضريبية, prerequisite for VAT-correct invoices and ETA
  e-invoicing), no NFSA food-safety license, no document-upload flow. Listing an
  unlicensed kitchen is a food-safety exposure.
- **Driver KYC** (identity/license/vehicle document records behind `is_verified`) —
  compliance-finance · medium · Drivers handle COD cash and ride public roads under
  the brand, yet "verified" is a bare boolean with no evidence trail — no national
  ID, license, vehicle registration, expiry tracking, or contractor agreement. In an
  accident, cash-theft dispute, or labor-classification challenge the platform can
  show no diligence; insurers will require these records.
- **ETA e-invoicing / e-receipt readiness** (no invoice generation of any kind) —
  compliance-finance · large · Egypt's Tax Authority mandates B2B e-invoicing
  (platform→restaurant commission) and is phasing in B2C e-receipts; the platform
  generates no invoice artifact at all — no numbered document, no PDF, no invoice
  table — so it cannot legally bill commission. ETA integration has months of lead
  time.

### Marketplace-liquidity (6)

- **Restaurant performance scorecards** (acceptance rate, prep-time accuracy,
  reject/cancel rate) — marketplace-liquidity · medium · Supply quality is
  unmanageable without measurement; for a platform whose ETA is built on
  merchant-entered `prep_time_high`, prep-accuracy visibility is the enforcement
  mechanism and the objective basis for featuring/demoting and commission-tier
  conversations. All raw data exists — pure views + UI.
- **Learned / load-aware prep-time model** — marketplace-liquidity · medium ·
  `prep_time_low/high` are static hand-entered columns feeding the binding
  `eta_at`/SLA; real kitchens vary 2–3x across the day, guaranteeing either padded
  ETAs (lost conversion) or broken promises (late credits). A rolling median of
  actual accepted→ready durations fixes both and feeds the scorecards.
- **Multi-order batching** (driver carries 2+ orders) — marketplace-liquidity ·
  large · The status model makes one-order-per-driver a hard invariant, capping
  throughput at ~2 deliveries/driver/hour; driver utilization _is_ the delivery
  margin. Same-restaurant / same-hotel-strip stacking (common in Sharm's hotel
  geography) could add 40–60% deliveries/hour at zero fleet cost — the biggest single
  economics lever toward sustainable GMV.
- **Driver utilization & dispatch-funnel metrics** (offer→accept rate, idle time,
  deliveries/hour) — marketplace-liquidity · small · Per-driver acceptance, TTL-lapse,
  deliveries/online-hour, and zone idle time tell you whether you're over/under-
  supplied and whom to coach or cut — all derivable from `order_assignments` and
  `driver_earnings`, which are written but never read in aggregate. Prerequisite data
  layer for surge, heatmaps, and shift planning.
- **Menu item auto-86 signal loop** (decline reasons → auto-hide → timed re-enable)
  — marketplace-liquidity · small · `is_available` is enforced, but the only way an
  item gets 86'd is a human remembering to toggle it, and rejects are whole-order —
  "we're out of X" destroys the whole basket and leaves the dead item to kill the
  next order. An item-level decline taxonomy + auto-hide + end-of-day re-enable makes
  the menu self-healing.
- **Menu photo pipeline** (upload, quality requirements, moderation) —
  marketplace-liquidity · medium · Food photos lift add-to-cart 15–30%, yet an item
  image is an optional raw "Image URL" text field typed by an admin — no upload path,
  no bucket, no validation, no moderation, and merchants can't submit photos at all.
  At 30+ restaurants this becomes the catalog-quality bottleneck and a broken-hotlink
  time bomb.

### Reliability-scale (2)

- **No CI/CD pipeline** — tests and typechecks run only when a human remembers —
  reliability-scale · small · Growth means frequent releases across six surfaces and
  60+ migrations; without automated gates, every merge to main risks regressions in
  the money paths (`place_order`, COD reconciliation, loyalty ledger). The repo's own
  20+ manual-audit fix PRs show the defect rate is real. Test infra (vitest,
  typecheck scripts, adapter smoke script) already exists to hook into.
- **No backup/DR posture** — PITR unverified, no restore runbook, no Supabase SPOF
  plan — reliability-scale · small · The database is the entire business (COD ledgers,
  loyalty points liability, driver earnings, order history) in one project in one
  region. A destructive migration or project incident with no rehearsed restore path
  could lose financial records; restore time is also revenue downtime. Schema is
  reproducible from in-repo migrations — data is not.

---

## P2 — Scale-moat (28, flagged not deep-verified)

These are compounding, longer-horizon advantages — the moat a mature marketplace
builds. **They were flagged during the audit but not adversarially verified**, so
treat this as a **backlog to re-confirm before committing**, not a to-do list. None
is launch-blocking; most belong after the money engine and the pilot ops are in
place.

| Item | Dimension | One-line why |
|---|---|---|
| Delivery-fee surge/peak/distance pricing | monetization | Flat 20–40 EGP ignores demand/time/distance; `per_km_fee` column is hardcoded to 0 — leaves 25–50% peak-fee uplift on the table. |
| Subscription / free-delivery pass (Talabat-Pro analog) | monetization | No recurring-revenue construct; a weekly tourist pass or monthly resident pass drives frequency lock-in — gated on card payments flipping on. |
| B2B hotel/corporate ordering accounts | monetization | Sharm is a hotel economy; no on-behalf ordering or consolidated invoicing to sell concierges — a defensible moat and a COD-trust solver via invoice billing. |
| BOGO / bundle / meal-deal engine | monetization | Promo kinds are percent/fixed off subtotal only; no item-level mechanics — bundles lift AOV 10–20% and are what restaurants most want to co-fund. |
| Packaging fee pass-through | monetization | No packaging line exists; a transparent 2–5 EGP line is standard, pure margin, trivially additive once the service-fee line exists. |
| Merchant onboarding/activation fee billing | monetization | No mechanism to charge restaurants anything; shares the missing merchant-billing rails with the P0 commission gap — design into the same statements construct. |
| Tourist-currency FX spread capture | monetization | Contingent lever — only real once multi-currency card acceptance ships; stale hardcoded rates are a trust risk today, not a revenue one. |
| Incident runbooks + on-call alerting path | ops-support | Good launch-day doc + one kill switch, but no runbook for recurring incident classes (sweep failure, Realtime outage, push expiry) and nothing pages a human. |
| A/B experimentation framework (PostHog flags unused) | retention-growth | Unit-economics levers (fees, thresholds, promo depth, reward size) will be tuned by gut; PostHog flags/experiments already ship in the bundle, just unwired. |
| Install attribution / UTM pipeline | retention-growth | When paid UA starts there's no way to attribute installs, compute CAC, or feed conversion back to ad networks; every marketing dirham spent before this is unmeasurable. |
| Email/CRM layer (no provider, no transactional email) | retention-growth | Phone-OTP auth never captures emails; the one source (waitlist) is broken and unread — no receipts, no lifecycle email, no launch-announcement export. |
| WhatsApp Business API automation | retention-growth | This market is WhatsApp-first; automated confirmations/status via Cloud API is table stakes for MENA delivery (~90%+ open rates) — today it's click-to-chat only. |
| Home feed ranking beyond static rating sort | retention-growth | The storefront orders by a mostly-uniform rating column; new restaurants are buried and closed ones can outrank open — feed-ranking quality is the compounding marketplace moat. |
| Dish search: typo tolerance + Arabic/multilingual matching | retention-growth | `String.includes` on English-only names fails a Russian typing "shaurma" or an Arabic speaker; also re-downloads every menu per keystroke (N+1 over the network). |
| Share-sheet virality beyond referral codes | retention-growth | No share affordance on restaurant/item screens and no web preview pages to receive links — captures none of the "what should we order tonight" group-chat distribution. |
| Versioned terms-of-service consent tracking | compliance-finance | Enforceability requires proving which version a user accepted and when; today acceptance is a passive sentence with no record, and guests may never see it. |
| PDPL (Law 151/2020) alignment | compliance-finance | Personal data is processed on Supabase infra outside Egypt; PDPL restricts cross-border transfers — policies never state hosting location, legal bases, or RoPA. |
| Courier insurance / third-party liability records | compliance-finance | Terms disclaim courier liability but Egyptian courts reach the principal in road-accident claims; no policy record, coverage tracking, or accident protocol exists. |
| Demand-responsive driver incentives (surge/quests) | marketplace-liquidity | Only incentive is a static per-delivery loyalty bonus paying the same at 3pm Tuesday as Friday 8pm; no lever to pull supply online when the unfilled-order problem bites. |
| Driver shift scheduling / supply planning | marketplace-liquidity | Supply is purely ad-hoc (a driver flips a toggle); no shift commitments or coverage forecast — caps growth past the founder personally texting riders. |
| Driver heatmap / positioning guidance + goals & streaks | marketplace-liquidity | Drivers idle wherever they are; dispatch searches around the dropoff, so a driver in the wrong district never gets offers — a zone hint raises effective supply for free. |
| Demand forecasting (orders by zone/hour) | marketplace-liquidity | Every supply decision runs on gut feel; even a "same weekday last 4 weeks" average would size Friday-dinner driver need and flag restaurant-thin zones. |
| Geographic expansion tooling (Sharm hardcoded end-to-end) | marketplace-liquidity | City #2 is schema surgery, not config: `zone_type` is a hard ENUM of 11 Sharm slugs used as PK across orders/restaurants/addresses; no city dimension exists, and the centroid fallback maps any coordinate on Earth to a Sharm zone. |
| Driver-GPS realtime broadcast channels are public | reliability-scale | A public channel means anyone with the anon key + an order UUID can watch a driver's live GPS or broadcast forged positions — a press/App-Store problem at scale (UUIDs are unguessable, so not a launch blocker). |
| No remote config for client features (compile-time flags) | reliability-scale | Turning card payments on or a misbehaving feature off requires a rebuild + store review; a boot-time flags fetch from `platform_settings` makes it a SQL UPDATE. |
| Load readiness unproven (admin board subscribes to ALL orders+drivers) | reliability-scale | At hundreds of concurrent orders the realtime layer is the choke point; Supabase tier limits (connections, msgs/sec, pg_net depth) are untested and hitting them mid-campaign degrades tracking exactly when volume peaks. |
| No write-retry/offline queue for checkout on resort WiFi | reliability-scale | A checkout failing hard on a transient timeout is an abandoned basket; `place_order` is already idempotent via a client key, so a retry-with-backoff wrapper recovers revenue at near-zero risk. |
| No secrets rotation runbook | reliability-scale | Long-lived shared secrets (push internal secret, Paymob HMAC, service-role key) with no rotation procedure; the vault-wired push secret has a non-obvious two-place update an unrehearsed rotation will break. |

---

## Recommended sequencing

A phased plan ordered by "what unblocks the most, soonest, at the least risk." Each
phase is a coherent milestone, not a hard gate — but the ordering is deliberate:
stop the bleeding, build the money foundation, staff a pilot, make it safe to scale,
then turn on the revenue engines.

### Phase 0 — Before ANY marketing spend (stop the two bleeds)

The cheapest, most urgent work. Neither is a heavy build; both remove live
liability.

1. **Reword or gate the unfulfillable late-credit promise** so the app stops making
   a claim it cannot keep. Until the SLA credit engine exists (Phase 1), the
   checkout `slaLine` and help-FAQ copy must not state an _automatic_ credit. This
   removes the Consumer Protection Law 181/2018 exposure and the app-review risk on
   order one.
2. **Add COD fraud caps:** new-user and guest order limits, plus a customer block
   flag on the profile that `place_order` checks. This closes the open fake-order
   surface before any spend drives strangers to the app.

### Phase 1 — The money foundation (unblocks the 5 clustered P0s)

3. **Build the credit-ledger + per-order commission snapshot.** Stamp the effective
   `commission_pct` onto every order at placement (stops the ongoing, permanent loss
   of billing data), and add a credit-ledger primitive reusing the proven promo-mint
   pattern. This single medium build unblocks: commission settlement, refund/goodwill
   credit, the SLA late-credit engine (which lets Phase 0's reworded promise become
   real again), restaurant payout statements, and honest revenue reporting.

### Phase 2 — Ops to run a pilot

4. **Admin support console** — order lookup by short code / phone, customer-360
   (past orders, loyalty, addresses), and `order_status_events` timeline. Pure UI
   over existing data; removes the "founder in the SQL editor" throughput cap.
5. **Refund / credit tool** in the console, on top of the Phase 1 ledger.
6. **Unfilled-order escalation** — no-driver alerting, automatic radius widening,
   customer comms when food is cooked but stranded.
7. **Server-side dispatch alerting** — page a human when the `dispatch_sweep` cron
   fails or stalls, so silent outages become impossible.

### Phase 3 — Safe to scale

8. **OTA / force-update gate** shipped _in_ the next binary (it cannot be
   retrofitted to installed clients).
9. **Honest ETA model** — add dispatch + haversine travel time to `eta_at` so the
   on-time promise (and its credits) stops trending systematically late.
10. **Delivery-radius / feasibility gating** using the dormant `per_km_fee`/`min_fee`
    columns, to reject or reprice unit-economic-loser long-haul orders.
11. **Deep links + push routing** — universal/app links and order-status push
    routing, so referral and re-engagement loops stop terminating in 404s and
    homepages. (Fix the broken waitlist route here too — the demand-capture surface.)

### Phase 4 — Revenue engines

12. **Order-level service fee** (small, near-pure margin, cheapest lever).
13. **Sponsored / featured placement** as a sellable ads product.
14. **Small-order fee** to monetize below-minimum baskets.
15. **Merchant-funded promos** (`funded_by` on `promo_codes`) so campaigns stop
    hitting the platform's own P&L.

### Later — P1 compliance and the P2 backlog

- **P1 compliance-finance:** restaurant settlement/payout system, VAT modeling,
  restaurant + driver KYC, and ETA e-invoicing. These become binding as the company
  registers for VAT (≈3–4 months of modest GMV) and issues its first commission
  invoice — plan the lead time, especially for the large-effort ETA integration.
- **P2 scale-moat backlog:** re-confirm and prioritize the 28 items as supply,
  volume, and a second city come into view.

---

## Use-of-funds mapping

For the fundraising narrative: each phase maps cleanly onto the investor deck's
use-of-funds buckets, so this report can be cited directly as the "what the money
builds" appendix.

| Phase | Primary bucket (deck) | What the spend buys |
|---|---|---|
| **Phase 0** — stop the bleeds | Infra & compliance (~10%) | Removes the Consumer-Protection-Law liability and the COD fraud surface before a single ad runs — de-risks the raise itself. |
| **Phase 1** — money foundation | Founder + engineering continuity (~15%) | The credit-ledger + commission snapshot: the core engineering that turns a working app into a billable business and protects revenue data daily. |
| **Phase 2** — pilot ops | Ops team (~40%) | Support console, refund tool, escalation, and dispatch alerting — the tooling the ops co-founder and first support hire operate; directly raises orders-per-ops-person. |
| **Phase 3** — safe to scale | Growth (~25%) + Infra & compliance (~10%) | OTA gate, honest ETA, radius gating, and working deep links — the reliability + growth-loop plumbing that lets referral, hotel, and RU-social spend actually convert. |
| **Phase 4** — revenue engines | Growth (~25%) | Service fee, sponsored placement, small-order fee, funded promos — the levers that lift contribution margin and take-rate as volume grows. |
| **Later** — P1 compliance + P2 | Infra & compliance (~10%) | VAT, KYC, e-invoicing, and settlement — the artifacts VAT registration, tax reporting, and hotel/acquirer due-diligence will require. |

The buckets in the deck's Slide 13 ask — **~40% Ops · ~25% Growth · ~15% Founder &
engineering · ~10% Infra & compliance · ~10% buffer** — line up with this sequence:
the largest bucket (Ops) funds the Phase 2 pilot tooling and the people who run it;
Growth funds the Phase 3–4 loops and levers; engineering continuity funds the Phase
1 foundation; and infra & compliance funds Phase 0 and the later regulatory work.

---

_All 42 P0/P1 gaps in this document were adversarially verified against the Sharm
Eats codebase (source references, existing partial infrastructure, and business
impact documented per item). The 28 P2 items were flagged during the same audit but
not deep-verified, and are listed as a backlog to re-confirm. This document is a
living roadmap — update it as phases land._
