# Pilot lifecycle test pack

Package 01 §2. Nine scenarios that must run cleanly before the pilot takes real
customers, plus a read-only assertion pack that proves each one landed correctly
in the database.

**Acceptance: 10 controlled runs with zero order/ledger mismatch.**

## The one rule

**Drive every transition through the real RPCs and the real apps.** Never
`UPDATE orders SET status = ...` to reach a state.

A lifecycle "passed" by writing rows directly proves nothing about
`place_order`, `advance_order_status` or the settlement path — the code that
will actually run in front of customers. It would certify a system that has
never been exercised, which is worse than running no test at all.

The assertion pack is deliberately **read-only** for the same reason. It can
only observe; it cannot manufacture a pass.

## Before you start

- Use real test accounts (a customer, a driver, a merchant staff login), not
  service-role SQL.
- Prefix test orders so they can be found and excluded from business metrics.
  Record each `short_code` in the results table below.
- Have the merchant tablet and driver phone actually in hand — several scenarios
  exist only to test what happens between two humans.

Run the assertions after each scenario:

```bash
psql "$PROD_URI" -v order_id="'<uuid>'" -f supabase/tests/pilot_lifecycle_assertions.sql
```

It prints `LIFECYCLE ASSERTIONS PASSED` plus a one-line summary, or raises with
every problem it found. `NOTES:` are informational and do not fail the run.

## Scenarios

### 1. COD happy path
place → accept → preparing → ready → dispatch → pickup → deliver → cash collected.

Expect: terminal `delivered`, full event chain, exactly one `order_financials`
row, exactly one `cod_collected` ledger entry.

### 2. Merchant rejects before preparation
Place, then reject from the merchant app.

Expect: terminal `rejected`, **no** cash collection row, customer informed.

### 3. Customer cancels while still legal
Cancel from the customer app before the cancellation window closes.

Expect: terminal `cancelled`, no cash row, no active offer left behind.

### 4. Dispatch failure / reassignment / no driver
Let an offer expire; force a reassignment; then run with no driver online.

Expect: no order is silently stranded; the watchdog fires (see
`OPS-RUNBOOK.md` §5); no assignment is left `offered` on a finished order.

### 5. Credit for refund or goodwill
Issue credit via the admin UI (`admin_issue_credit`), then confirm the customer
sees it in their wallet.

Expect: `credit_ledger` row; issued credit never exceeds the order total.

### 6. Settlement draft → finalize → paid
Run the weekly settlement, finalize it, mark paid **with a reference**
(mig 131 requires one).

Expect: the delivered order is inside exactly one settlement period; net payable
matches commission maths in `FINANCIALS.md`.

### 7. Driver cash collection → hand-in
Collect COD on two orders, hand in part, then the remainder.

Expect: ledger nets to the expected balance; a partial hand-in leaves the
correct outstanding amount.

### 8. Duplicate actions
Double-tap accept; submit checkout twice with the same idempotency key; confirm
the same cash hand-in twice.

Expect: no duplicate order, no duplicate ledger entry, no illegal transition.
This is the scenario most likely to find a real bug — run it deliberately, not
gently.

### 9. Poor-network recovery
Between each critical transition, put the device in airplane mode, act, then
reconnect.

Expect: no lost transition, no duplicate on retry, Realtime catches up rather
than leaving a stale screen.

## What the assertions check

| # | Assertion | Why it matters |
|---|---|---|
| 1 | Terminal status is `delivered`/`cancelled`/`rejected` | a stuck order is the most common real failure |
| 2 | Status events exist and the newest agrees with `orders.status` | `advance_order_status` is the only legal writer; disagreement means something bypassed it |
| 3 | Exactly one `order_financials` row per delivered order | zero hides revenue from settlement; two double-count it |
| 4 | No unresolved `order_financials_failures` row | an unresolved row means money was never recorded |
| 5 | Delivered COD ⇒ exactly one `cod_collected` entry; cancelled ⇒ none | otherwise a driver holds cash the platform cannot see |
| 6 | Credit issued ≤ order total | refunding more than was charged |
| 7 | No assignment still `offered` on a finished order | the driver app would show an impossible job |
| 8 | Settlement period covers the order (note, not failure) | settlements run weekly, so a fresh order legitimately has none |

### Two things the first run taught us

**`accepted` is not "still working".** The first draft also failed an assignment
left `accepted` on a finished order. Production showed all 9 such rows sit on
finished orders: `accepted` is where a *completed* assignment rests — nothing
moves it onward. Failing it would have failed every correct pilot run forever.
Only `offered` is genuinely impossible on a finished order.

**Literals must be verified, not guessed.** The draft checked
`payment_method = 'cash'` and `reason = 'collection'`. The real values are
`cash_on_delivery` and `cod_collected`. A wrong literal does not error — the
branch simply never runs, so the check passes forever while testing nothing.

Both were caught by running the pack against real production orders before
trusting it.

## Validation of the pack itself

Run 2026-07-27 against production (read-only):

- **Positive** — real delivered COD order `SE-8T7SFT`: **PASSED**
  (7 status events, 1 financial row, 1 cash collection, 0 credit).
- **Negative** — a cancelled order carrying a stuck `offered` assignment:
  **correctly FAILED** with
  `1 assignment(s) still OFFERED on a cancelled order`.

A pack that has only ever passed has not been shown to discriminate. Both
directions were exercised.

## Results log

Record every controlled run. Ten clean rows is the §2 acceptance gate.

| # | Date | Scenario | Order code | Operator | Assertions | Notes |
|---|---|---|---|---|---|---|
| | | | | | | |

_(Empty: these are owner-run operational rehearsals with real devices and real
staff. They cannot be produced from a development session, and a fabricated row
here would defeat the purpose of the gate.)_
