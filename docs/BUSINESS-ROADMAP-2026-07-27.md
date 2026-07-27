# Sharm Eats — current A-to-Z business roadmap

**Baseline:** 2026-07-27

**Strategy:** prove food delivery in Sharm first, COD first, then cards, own
brands, grocery, pharmacy and city #2 only after explicit operating gates.

This replaces older “code 100% complete” launch claims as a planning source.
Those documents remain useful history, but several are stale. The current
baseline is the verified July 27 production state:

- migration 136 staff-role enforcement and migration 137 push routing are live;
- PostHog is wired but needs the next customer build before events arrive;
- campaigns now reach the push function, but device receipt polling/retry and
  customer marketing preferences are not built;
- cards are deliberately off; the live launch path is COD;
- 23 lifetime orders are not enough to prove settlement, retention or scale;
- a production backup exists, but off-machine retention and a rehearsed restore
  are still owner actions;
- grocery, pharmacy and city #2 are architecture, not launch-ready features.

## The single priority

Build a trustworthy **first order → delivered order → reconciled money → second
order** loop. Do not widen the product until that loop works repeatedly with
real customers, restaurants and drivers.

The best near-term revenue feature is **exact Order Again**: rebuild the last
order including modifiers, confirm current price/availability, and pair it with
a consented 7–14 day reminder. Most of the UI, cart, history, analytics and push
infrastructure already exists.

## Priority rules

| Priority | Meaning |
|---|---|
| P0 | A failure can lose money, strand an order, breach trust/compliance, or make recovery impossible |
| P1 | Directly improves completed orders, repeat orders, or operator truth |
| P2 | Helps conversion/efficiency after the pilot loop is proven |
| Later | Expansion or sophistication that should not delay Sharm food validation |

Effort is relative: **S** is a contained change, **M** is a multi-surface
feature, and **L** is a new operating capability.

## Phase 0 — make the pilot safe and measurable

**Goal:** one known release, one recoverable database, and one fully rehearsed
COD lifecycle.

| Work | Priority / effort | Done when |
|---|---|---|
| Copy the latest database backup off this Mac and rehearse an isolated restore | P0 / S owner | Schema, data, auth relationships, functions, RLS and row counts verify in the restored environment |
| Run a real COD lifecycle | P0 / M ops | Place → accept → prepare → dispatch → pickup → deliver → collect cash → hand-in → finalize/pay settlement, with zero ledger variance |
| Exercise unhappy paths | P0 / M ops | Reject, cancel before/after acceptance, issue credit, refund/repair, no-show and failed dispatch all have an owner and an auditable result |
| Fire monitoring deliberately | P0 / S | Telegram/ops alert is received for a controlled watchdog event and acknowledged |
| Ship the next customer build with PostHog | P0 / S | A real device emits app-open → restaurant → item → cart → checkout → order → delivered/reorder events in EU PostHog |
| Add release provenance | P0 / S | Landing, admin and merchant expose commit SHA/build time; production-vs-main drift is visible |
| Physical-device matrix | P0 / M owner | Customer, restaurant and driver pass iOS/Android push, deep link, RTL, poor network, background/foreground and location tests |
| Resolve unsupported multi-currency copy | P0 / S | Remove the promise until conversion exists, or ship a sourced, timestamped display-rate system; never promise an unavailable feature |
| Enable compromised-password protection and review direct DB security | P0 / S owner | Dashboard protection is on; direct clients are inventoried before SSL/CIDR tightening |

### Gate 0

Do not invite public customers until:

- at least 10 complete test/pilot lifecycles have zero order or money mismatch;
- the database restore has succeeded once;
- every live web/mobile artifact has a known SHA/build;
- the alert path and support escalation have been exercised;
- the customer build is visibly sending analytics.

## Phase 1 — closed COD pilot

**Goal:** prove operations with a deliberately small founding cohort.

### Supply and operations

- Convert the first **5–10 restaurants** from verbal commitment to signed pilot
  LOIs; do not wait for all 25.
- Load real menus, hours, prep times, pickup pins, payout details and named
  owner/manager/staff accounts.
- Train each merchant on accept/reject, 86 item, pause storefront, chat,
  cancellation and settlement.
- Contract and train enough riders for one zone and one dinner window before
  widening coverage.
- Use a shift checklist: restaurants open, tablets charged, riders online,
  support owner assigned, cash balances reviewed.
- Run and sign off weekly merchant statements and driver cash hand-ins.
- Add a hard driver COD-debt ceiling before volume makes cash custody material.

### Customer acquisition

- Recruit the first customers through hotel desks, restaurant QR cards,
  founder network and a controlled referral cohort.
- Keep paid acquisition near zero until conversion and repeat rate are measured.
- Ask for an app-store review only after a successfully delivered, positively
  rated order; `expo-store-review` is already installed.
- Capture the source of every customer: hotel, restaurant QR, referral, organic,
  paid or founder.

### Gate 1

Advance after at least **50 delivered real orders** with:

- acceptance rate ≥ 90%;
- cancellation/rejection combined < 8%;
- settlement and driver-cash variance = 0;
- every customer complaint has an owner and resolution;
- no restaurant or rider is surprised by what they owe or are owed.

## Phase 2 — complete the second-order engine

**Goal:** make repeat purchase easier than the first purchase.

### Sprint 2A — exact Order Again

1. Preserve canonical modifier option IDs in the order snapshot.
2. Rebuild the exact previous basket, quantities, modifiers and notes.
3. Revalidate current price, stock, restaurant state and minimum basket.
4. Explain changes before checkout instead of silently substituting.
5. Promote one clear “Order again” card on Home and Orders.
6. Track impression → tap → rebuilt cart → checkout → delivered.
7. Add a consented reminder at a simple cadence, initially 7 or 14 days.

**Acceptance:** customized orders rebuild correctly; unavailable/changed items
are explained; no stale price can be ordered; the full funnel is visible.

### Sprint 2B — retention correctness quick wins

- Merge guest and server restaurant favourites at sign-in instead of replacing
  one with the other.
- Make the fake notification switches real.
- Store marketing consent version/time/source, transactional vs marketing
  preference, quiet hours and locale.
- Filter campaigns server-side; the UI setting alone is not enforcement.
- Add frequency caps and unsubscribe/opt-out handling before marketing volume.

### Gate 2

After enough time for a meaningful cohort, target:

- 30-day first-to-second-order conversion ≥ 25%;
- exact-reorder completion materially above normal browse-to-order conversion;
- zero preference/consent violations;
- campaign → app-open → order attribution visible in PostHog.

## Phase 3 — proper notifications and customer-loved features

**Goal:** messages are consented, truthful and useful, and saved intent survives
devices and sign-in.

### Proper notification delivery

- Store Expo ticket IDs and distinguish `queued`, `accepted_by_expo`,
  `delivered_to_device`, `failed`, `expired` and `suppressed`.
- Poll Expo receipts, prune dead tokens and retry only retryable failures with
  capped exponential backoff.
- Stop calling an HTTP 2xx “delivered”; it only proves transport acceptance.
- Add test-send, draft, scheduling and operator-visible failure detail.
- Use explicit allow-listed app routes in payloads.
- Add a notification inbox only after receipt/retry/preferences are correct.

### Loved/saved customer features

1. Add menu-item favourites and a Saved screen.
2. Keep restaurant favourites and item favourites separate.
3. Sync saved state across devices and merge offline/guest mutations safely.
4. Add favourite restaurant reopened, saved item back-in-stock and genuine
   saved-item offer triggers.
5. Add server cart snapshots and restore the latest valid cart across devices.
6. Trigger abandoned-cart reminders only for consented customers, with stock,
   restaurant-open and frequency-cap checks.

### Recommendations

Start explainable, not “AI”:

- Order again;
- favourites;
- cuisine affinity;
- open now / deliverable to this address;
- popular with similar local/tourist cohorts;
- exclude recently rejected, unavailable or repeatedly dismissed options.

Measure incremental order conversion before adding a complex model.

## Phase 4 — cards and public launch

**Goal:** enable tourist-friendly payment without double charges or ambiguous
refunds.

### Owner prerequisites

- Egyptian entity/bank/tax position confirmed.
- Paymob KYC, production credentials and callback configuration complete.
- Accountant confirms commission VAT and ETA/e-invoicing treatment.

### Engineering and operations gate

- Deploy `paymob-create-intention` and verify webhook HMAC in production.
- Prove idempotent intention creation and webhook replay handling.
- Prove success, failure, abandonment, timeout and delayed-webhook recovery.
- Prove full and partial refunds and a safe operator repair path.
- Reconcile Paymob transaction, order, credit/refund and settlement totals.
- Keep the feature flag off until all cases pass.

### Gate 4

Enable cards gradually after at least 20 controlled transactions covering
success, duplicate callback, failure, abandoned checkout, full refund and
partial refund, with:

- zero double charge;
- zero paid order without a matching gateway transaction;
- zero gateway success without a recoverable order;
- zero reconciliation variance.

## Phase 5 — operating scale in Sharm

**Goal:** grow without founder memory becoming the system.

- Convert support messages into cases with status, owner, SLA and outcome.
- Add restaurant/rider incident playbooks and an on-call rota.
- Enforce driver COD debt/cash hand-in thresholds.
- Automate weekly settlement review, exception queue and sign-off.
- Track unit economics by order, zone, restaurant, acquisition source and
  own-brand vs marketplace.
- Add restaurant scorecard coaching, not just the score display.
- Formalize rider supply planning by dinner-window demand.
- Add immutable release artifacts and a staging restore; reconcile the
  divergent migration ledger before routine schema deployment.

### Operating dashboard

Review daily:

- placed, accepted, delivered, rejected and cancelled orders;
- acceptance, prep, dispatch, delivery and total time;
- failed push/OTP/payment/order-state events;
- open settlements, cash debt and finance repair queues;
- support cases and promised credits/refunds.

Review weekly:

- GMV, commission, contribution and variable cost/order;
- new customers, first-order conversion and 30-day repeat;
- orders/customer, referral CAC and payback;
- restaurant activation/retention and rider utilization;
- SLA-credit rate and refund/complaint rate.

### Gate 5

Do not open a second city or vertical until Sharm sustains:

- positive contribution after real variable costs;
- 100+ orders/day for several consecutive weeks;
- repeat rate and service levels at target;
- reconciled settlements/cash every week;
- a trained operator can run a shift without the founder.

## Phase 6 — own kitchen

Treat the Mercato kitchen as a separate operating business sharing the
platform, not as a software feature.

Before fit-out:

- entity, lease, food/NFSA licensing and insurance confirmed;
- menu engineering and actual recipe/packaging costs completed;
- fit-out quotes and contingency approved;
- staffing, procurement, wastage and food-safety SOPs costed;
- merchant-conflict positioning agreed honestly.

Launch brands sequentially. Require one brand’s food cost, prep time, rating,
repeat rate and contribution to stabilize before adding the next. Use
`platform_revenue_report` so own-brand subtotal is never double-counted with
marketplace commission.

## Phase 7 — expansion

### Grocery

Only after the Sharm food gate. First make `vertical_id` load-bearing end to
end, then build decimal/weight pricing, stock, bulk catalog, substitutions,
picker workflow, partial repricing/refunds and grocery-specific operations.
Current estimate remains **12–18 weeks**, not a configuration flip.

### Pharmacy

After grocery and after entity/licensing advice. Add prescription upload and
pharmacist approval, age gates, immutable audit trail, substitutions and
restricted-item controls. Current estimate remains **16–25 weeks**.

### City #2

After sustained Sharm proof. The schema needs a real city dimension, city-bound
zones/settings/onboarding/dispatch and city-level operations. Expansion is not
zero-engineering and is outside the current launch round.

## Quick-win queue

Ordered by impact relative to effort:

1. Ship customer build with PostHog and verify one full funnel.
2. Rehearse COD lifecycle, settlement and restore.
3. Remove unsupported multi-currency promise until implemented.
4. Make notification consent/preferences real.
5. Merge guest favourites correctly.
6. Complete exact reorder including modifiers.
7. Add post-delivery app-store review prompt.
8. Add `/version.json` and production SHA monitoring.
9. Deliberately test ops alerts.
10. Add driver COD debt limit.

## Explicitly not now

- notification inbox before receipts/preferences;
- opaque AI recommendations before simple signals are measured;
- public cards before reconciliation/refunds are proven;
- grocery/pharmacy before food-market fit;
- city #2 before Sharm can run without the founder;
- paid growth before first-order conversion and repeat are measurable;
- all 25 restaurants at once before 5–10 can operate cleanly.

## Recommended first delivery cycle

One cycle, in this exact order:

1. **Measurement release:** customer build with PostHog; physical-device smoke.
2. **Business safety rehearsal:** COD happy/unhappy paths, settlement, cash
   hand-in, alerts and restore.
3. **Retention sprint:** exact reorder, guest-favourite merge and real
   notification consent/preferences.
4. **Closed pilot:** five restaurants, a controlled rider pool and 50 delivered
   orders.
5. **Decision review:** use observed conversion, repeat, operations and unit
   economics to decide whether the next cycle is cards, deeper retention, or
   operational capacity.

That sequence produces evidence at every step and keeps irreversible spend and
expansion behind measurable gates.
