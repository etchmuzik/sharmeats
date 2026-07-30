# Package 04 — payments, refunds, support and cash operations

## Outcome

Prove every existing money rail against production-like data, then add only the
missing controls: partial refunds, case-based support, a driver cash-exposure
ceiling and an exception queue. Card payment must remain gated until the evidence
below exists.

This package does **not** replace the current payment, settlement, credit or cash
ledger systems.

## Current evidence

- `place_order` has an idempotency key and server-authoritative repricing.
- Card orders use `paymob-create-intention`, signed `paymob-webhook`,
  `settle_paymob_payment`, and card-state guards.
- `order_refunds`, `settle_paymob_payment` and `finalize_full_card_refund` are
  **in production since 2026-07-30** (mig 180). The root cause of their earlier
  absence was a migration-ledger gap: migration 121 was authored but **never
  executed** — the ledger ran 110..119 then jumped to 122 — while two edge
  functions called its RPCs by name. Mig 180 re-delivered it after a line-by-line
  audit (logic unchanged, grant hygiene corrected), and the ledger now carries
  explicit reconciliation rows for 120 (applied by hand, unstamped) and 121
  (never run, superseded). `scripts/check-db-drift.sh` exists so this class of
  gap fails loudly in the future. `paymob-refund` and `paymob-create-intention`
  are still **not deployed** as Edge Functions (only `paymob-webhook`).
- COD collection, driver earnings, driver cash custody, hand-ins, driver
  settlements, merchant settlements and customer credit already exist.
- Support is one message thread per customer. It has messages and realtime, but
  no case status, owner, priority, SLA, resolution or reason taxonomy.
- The driver cash balance is visible, but there is no hard exposure ceiling that
  stops another COD assignment.
- Cards remain feature-gated and are not launch-proven merely because the code
  exists.

## Expected repository surfaces

- additive migrations for partial refunds, support cases, cash limits and
  finance exceptions plus regenerated DB types/security tests;
- current production payment, assignment, settlement, credit and cash RPC
  bodies where behavior changes;
- `supabase/functions/paymob-create-intention`, `paymob-webhook` and
  `paymob-refund` with their tests;
- customer checkout/order/support repositories and routes;
- admin finance/cash/support/dispatch/refund pages and types;
- driver job/cash UI and assignment error handling;
- reconciliation scripts/reports, scheduled checks and operating runbooks.

## Slice A — executable money-path proof

> **Status 2026-07-30 — BUILT.** Three artifacts, all with negative controls:
> `supabase/tests/money_path_assertions.sql` (all eight scenario families through
> public RPCs only, four identities asserted, 9/9 green on a prod-schema scratch
> DB, 5/5 sabotage controls bite); mig 181's `payment_reconciliation_report`
> (admin export) + `payment_reconciliation_sweep` (daily cron
> `sharmeats-daily-payment-reconciliation`, one aggregated alert per class) over
> the seven classes below **plus an eighth** — `card_captured_but_cancelled`,
> the delayed-webhook-after-local-cancel case the scenario work surfaced; and
> `scripts/check-db-drift.sh` (repo-vs-database drift: unledgered migration
> files, edge-function RPC references that don't exist). The sweep's first
> production run found 11 findings, all `cod_delivered_uncollected` — 8
> pre-launch owner-test orders and 3 App-Review DEMO fixtures — **awaiting owner
> triage** (mark collected or annotate as test data; the daily alert repeats
> until resolved, by design).

Build a deterministic test pack and a production-safe reconciliation report.
Fixtures must be created through public RPCs/functions, never direct
authority-column updates.

Required scenarios:

1. COD order: quote, place, accept, assign, collect exact amount, deliver.
2. COD cancellation before pickup and after acceptance.
3. Customer credit used alone and with COD if the current contract permits it.
4. Card success, decline, checkout abandonment, timeout, delayed webhook and
   duplicate webhook.
5. Full card refund, duplicate refund request and provider retry.
6. Merchant settlement for card and COD.
7. Driver earning, COD cash ledger entry, hand-in and statement.
8. Financial snapshot/repair-queue failure from migration 135.

For every completed scenario assert:

```text
order total
= item subtotal + delivery + service + small-order + tip - discount - credit

payment captured/refunded
= authoritative provider and refund records

merchant payable + platform commission + driver components
= the documented accounting treatment for that payment method

driver cash balance
= immutable ledger sum
```

Add an admin-only reconciliation surface or export with order ID, provider
references, captured/refunded amount, settlement IDs, ledger IDs, mismatch
category and age. It must not expose secrets or full payment details.

An automated daily job should detect:

- paid card order without a matching provider transaction;
- provider transaction without a settled order;
- refund pending beyond its SLA;
- order refund total above captured total;
- delivered COD order without collection/ledger entry;
- duplicate settlement coverage;
- finance-repair item still open.

Alerts aggregate by incident class; they do not send one noisy alert per row.

## Slice B — controlled card rollout

> **Status 2026-07-30 — database rail LIVE, delivery rail still not deployed.**
> Mig 180 landed `payment_attempts`, `settle_paymob_payment`,
> `finalize_full_card_refund` and both refund guards in production (the 121
> ledger gap in the 2026-07-28 note is resolved and stamped). The card DB path
> is now proven end-to-end by the Slice A pack: settle, duplicate webhook,
> second-txn rejection, amount/integration mismatch, decline, abandonment,
> timeout, delayed webhook, full refund + provider retry. Still true: neither
> `paymob-create-intention` nor `paymob-refund` is a deployed Edge Function
> (only `paymob-webhook`), no Paymob secret exists in the vault, zero real card
> orders exist, and every owner prerequisite below remains open.
>
> Prerequisites, verification commands and the full acceptance gate are in
> [`../CARD-PAYMENT-GATE.md`](../CARD-PAYMENT-GATE.md). Cards remain dark.

### Owner prerequisites

- completed Paymob commercial/KYC approval;
- production integration ID, public key, secret key and HMAC secret stored only
  in the approved secrets manager;
- webhook URL registered and tested;
- finance owner and refund operator named;
- written dispute, refund and customer-support policy;
- real settlement bank-account verification.

### Technical rollout

1. Verify deployed Edge Function versions and secrets without printing secrets.
2. Run Paymob test-mode scenarios including tampered and replayed callbacks.
3. Deploy a customer build with cards visible only to an allow-listed pilot
   cohort. Do not use a client-only boolean as the authority.
4. Run at least 20 controlled low-value transactions across success, failure,
   abandonment, refund and duplicate-callback paths.
5. Reconcile each transaction to Paymob, the order, refund rows, merchant
   settlement and platform report.
6. Expand by cohort only while mismatch count is zero and alerting is healthy.

The customer must never see “paid” based on a browser redirect. Only the signed,
amount-checked server webhook can settle payment. A delayed success after local
timeout goes to an exception path; it must not silently lose the customer's
money or revive a cancelled kitchen order.

### Card acceptance gate

- zero unexplained variance across the controlled transaction set;
- duplicate callbacks are harmless;
- a duplicate intention cannot create a second chargeable order;
- failed/abandoned orders never reach the kitchen;
- successful late callbacks are visible to operations;
- refund operator can complete and reconcile a real refund;
- Sentry/ops alerts are proven deliberately.

## Slice C — partial refunds and order adjustments

Do not overload the current one-full-refund model. Introduce an additive refund
ledger that supports several idempotent adjustments without weakening existing
full-refund safety.

Suggested model:

```text
order_refunds
  id
  order_id
  idempotency_key unique
  kind full|partial|credit
  requested_amount_egp
  provider_amount_egp
  status requested|processing|succeeded|failed|manual_review
  reason_code
  operator_id
  provider_ref unique null
  request_payload, response_payload  -- redacted
  created_at, settled_at

order_refund_items
  refund_id
  order_item_id
  quantity
  amount_egp
  reason_code
  unique(refund_id, order_item_id)
```

Before migration, inspect whether altering the existing
`order_refunds_one_active_or_succeeded` index or enum would break the full-refund
function. Prefer a staged migration:

1. add the new fields/child rows while old full refund continues;
2. add `request_order_refund` and `finalize_order_refund` service-role RPCs;
3. update the Edge Function to send the server-computed amount;
4. backfill only facts that can be derived;
5. switch admin UI;
6. retire the one-full-refund restriction after compatibility proof.

Rules:

- refundable balance = captured amount minus succeeded provider refunds;
- the client/operator selects items and reason, but the server computes the cap;
- refund amount cannot exceed the remaining captured amount;
- provider amount and currency must match the request before finalization;
- concurrent requests lock the order/refund balance;
- only sum(refunds) = captured amount transitions the order to fully refunded;
- partial refund creates settlement adjustments rather than rewriting historical
  settlement facts;
- COD remediation uses customer credit or an audited cash payout workflow, not a
  fake Paymob refund;
- goodwill credit is separately labeled from return of customer funds;
- order status and payment status remain distinct.

Admin UX shows original charge, prior refunds/credits, refundable balance, item
selection, reason, required confirmation and provider result. High-value or
repeated refunds can require owner approval.

## Slice D — support cases and SLA

> **Status 2026-07-30 — BUILT, contrary to this slice's original "planned"
> framing.** Mig 151 delivered `support_cases` (status, priority, reason,
> assignment, SLA due-at columns, resolution code/note) and its events table in
> production. The model below is retained as the reference the implementation
> follows.

Keep `support_messages` compatible, but place conversations inside an explicit
case lifecycle.

```text
support_cases
  id
  customer_id
  order_id null
  status open|waiting_customer|waiting_ops|resolved|closed
  priority low|normal|high|urgent
  reason_code
  assigned_to null
  opened_at, first_response_due_at, resolution_due_at
  resolved_at, closed_at
  resolution_code, resolution_note
  last_message_at

support_case_events
  case_id
  event
  actor_id
  metadata
  created_at
```

Add `case_id` to new messages. For compatibility, existing user threads remain
readable and are attached to a migration-created legacy case only if the
relationship is unambiguous; otherwise leave them as historical messages.

Customer behavior:

- start from an order or general Help;
- choose a localized reason;
- see status, expected response and complete message history;
- receive an operational notification for a support reply;
- reopen within a bounded window or create a new case.

Admin behavior:

- queue by priority/SLA/status/owner;
- claim/assign/reassign with audit;
- see the linked order and money actions without direct authority-column edits;
- use explicit refund/credit actions from Slice C;
- resolve with a structured code and note;
- report first-response and resolution time.

RLS prevents cross-customer reads. Only authorized support/admin roles can
assign, resolve or view all cases. Message bodies and attachments have a
retention policy and are covered by account deletion/anonymization.

## Slice E — driver COD exposure ceiling

> **Status 2026-07-30 — BUILT and in `observe` mode, contrary to the original
> "planned" framing.** Migs 149/150 delivered exactly this design: the three
> settings below (soft 3000 / hard 5000 / mode `observe`),
> `driver_cod_capacity` computing custody from the immutable ledger inside the
> assignment transaction, both `assign_driver` and `auto_assign_order` sharing
> the same check, `driver_cod_limit_events` telemetry, `my_cod_capacity` for
> the driver UI and `admin_grant_cod_override` (reason + expiry + audit). The
> remaining work is the operating decision this section already prescribes:
> observe a full cycle, choose limits from evidence, flip the mode setting.

Add settings for:

```text
driver_cod_soft_limit_egp
driver_cod_hard_limit_egp
driver_cod_limit_mode = observe|enforce
```

The authoritative assignment/acceptance RPC must calculate current cash custody
from the ledger and the prospective COD amount under the same transaction/lock.

- Under soft limit: allow.
- Crossing soft limit: allow but warn driver and ops.
- Crossing hard limit: reject another COD assignment with a stable error code.
- Non-COD work remains eligible unless a different safety rule blocks it.
- An already collected/current order is never stranded by the limit.
- Admin override requires reason, expiry, actor and audit event.
- A hand-in immediately restores capacity.
- Manual/automatic assignment and race conditions share the same server check.

Start in `observe` for one full operating cycle. Compare predicted blocks with
real hand-in behavior, choose limits from evidence, then enable enforcement.

Driver UI shows cash held, limit, required hand-in and who to contact. Admin cash
UI shows limit utilization and blocked assignment attempts.

## Slice F — settlement and finance exception operations

> **Status 2026-07-30 — settlement lifecycle and exception DETECTION built;
> the owned exception-queue workflow remains open.** Idempotent
> generate/finalize/mark-paid settlement RPCs with weekly crons have existed
> since migs 074/083/084/105 (payment reference required since 131), and mig
> 135's `order_financials_failures` is the failed-snapshot repair queue. Mig
> 181's eight-class reconciliation detector + daily sweep now surfaces
> unmatched card payments, open snapshot repairs, settlement overlap, refund
> SLA breaches and uncollected COD as aggregated alerts with an admin export.
> What this section specifies beyond that — a generic exception table with
> severity/owner/state and narrow resolution RPCs recording before/after facts
> — is still unbuilt; today resolution is manual admin SQL guided by the
> report.

Add an explicit exception queue, not automatic mutation of settled history:

- unmatched card payment;
- failed snapshot/commission repair;
- merchant settlement variance;
- driver statement/cash variance;
- refund awaiting settlement adjustment;
- stale draft/finalized payout;
- manual write-off or adjustment awaiting approval.

Every exception has type, entity IDs, severity, state, owner, notes, detected
facts, resolution action and immutable events. Resolution calls narrow RPCs and
records before/after facts. It never asks an operator to patch an order row.

Generate and finalize settlements idempotently. Once finalized, corrections are
new adjustment rows in a later statement, never silent rewrites.

## Analytics and operational signals

- `payment_checkout_started/completed/failed/abandoned`;
- `payment_reconciliation_mismatch`;
- `refund_requested/succeeded/failed`;
- support opened, first response, resolution and reopen;
- COD soft/hard limit warning/block/override;
- settlement/finance exception opened and resolved.

Money analytics use order/refund IDs and bounded error codes, not card data or
free-text support content.

## Tests and verification

Database:

- payment/refund idempotency and concurrent calls;
- refund upper bound and full-vs-partial state;
- settlement adjustment accounting;
- support owner/cross-user RLS and event immutability;
- cash-limit manual and automatic assignment races;
- override authorization/expiry;
- finance exception authorization.

Edge Functions:

- webhook signature, amount, currency and replay;
- delayed/duplicate callbacks;
- provider timeouts and idempotent retry;
- partial/full refund request and response mismatch;
- secret failure closed.

Applications:

- customer card, support and refund status UX;
- admin reconciliation, refund, support, cash and exception workflows;
- driver cash-limit states;
- all changed copy in five locales and RTL.

E2E:

- execute every Slice A scenario against a production-shaped environment;
- run a live controlled Paymob transaction/refund before broad enablement;
- prove one support case through reply, refund/credit and close;
- prove a hand-in unblocks a limited driver.

## Rollout and rollback

1. Ship reports/test harness with no behavior change.
2. Prove current COD/full-refund/settlement rails.
3. Add support cases compatibly.
4. Add partial refunds behind an admin allow-list.
5. Observe then enforce driver cash limits.
6. Complete controlled card pilot.
7. Expand cards only after the acceptance gate.

Rollback hides new UI and stops new partial-refund/case producers; it does not
drop financial records. Old full refunds, support history and COD processing
must remain functional.

## Acceptance

- Every core money scenario has an executable, repeatable proof.
- Daily reconciliation detects known mismatches and shows zero unexplained
  variance before cards expand.
- Partial refunds cannot over-refund, double-refund or corrupt settlements.
- Support has case ownership, SLA, resolution and auditable money actions.
- Driver COD exposure is measured, then transactionally capped without blocking
  non-COD work.
- Financial exceptions are visible, owned and resolved through audited actions.
- Card enablement remains reversible and cohort-controlled.
