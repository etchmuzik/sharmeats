# Roadmap-to-spec traceability audit

**Audit date:** 2026-07-27
**Last verified against production:** 2026-07-27 (notification rows re-checked
after migrations 142/143 landed; see [03 § A status](03-notifications-and-crm.md#slice-a-status))

This is the completeness check for
[`../BUSINESS-ROADMAP-2026-07-27.md`](../BUSINESS-ROADMAP-2026-07-27.md).
Every roadmap commitment is either mapped to an implementation package, marked
as an owner/operating gate, or explicitly deferred with its prerequisite.

Status meanings:

- **Built/prove:** the capability exists; the package asks for production or
  operating evidence rather than a rebuild.
- **Partial:** important primitives exist, but the stated outcome does not.
- **Planned:** the implementation-ready design is in the linked section.
- **Owner/ops:** no code can complete it without the named business action.
- **Deferred by gate:** intentionally blocked until the prerequisite is met.

## Phase 0 — safe, measurable pilot

| Roadmap commitment | Status | Specification / acceptance |
|---|---|---|
| Off-machine backup and isolated restore | Partial + owner | [01 § 1](01-pilot-safety-release.md#1-rehearsable-database-restore) |
| COD happy-path lifecycle through settlement/cash | Built/prove | [01 § 2](01-pilot-safety-release.md#2-pilot-lifecycle-test-pack), [04 § A](04-payments-support-cash.md#slice-a--executable-money-path-proof) |
| Reject/cancel/credit/refund/no-show/dispatch unhappy paths | Built/partial; prove | [01 § 2](01-pilot-safety-release.md#2-pilot-lifecycle-test-pack), [04 § A](04-payments-support-cash.md#slice-a--executable-money-path-proof) |
| Deliberately fire and acknowledge monitoring | Partial | [01 § 5](01-pilot-safety-release.md#5-deliberate-monitoring-exercise) |
| Fresh customer build and complete PostHog funnel | Partial | [01 § 4](01-pilot-safety-release.md#4-posthog-funnel-proof), [05 § E](05-tourist-trust-growth.md#slice-e--conversion-and-retention-measurement) |
| Web/mobile release SHA and drift | Planned | [01 § 3](01-pilot-safety-release.md#3-release-provenance) |
| Physical-device matrix | Planned + owner | [01 § 6](01-pilot-safety-release.md#6-physical-device-matrix) |
| Honest multi-currency copy or sourced display rates | Partial | [05 § A–B](05-tourist-trust-growth.md#slice-a--truthful-trust-copy-now) |
| Compromised-password protection and direct-DB review | Owner | [01 § 7](01-pilot-safety-release.md#7-owner-security-toggles) |
| Gate: 10 clean lifecycles, restore, SHA, alert, analytics | Planned evidence gate | [01 acceptance](01-pilot-safety-release.md#acceptance-gate) |

## Phase 1 — closed COD pilot

| Roadmap commitment | Status | Specification / acceptance |
|---|---|---|
| Sign first 5–10 restaurant pilot LOIs | Owner/ops | [01 pilot operating gate](01-pilot-safety-release.md#pilot-operating-gate) |
| Load real menus/hours/prep/pins/payout/staff | Owner/ops + existing product | [01 pilot operating gate](01-pilot-safety-release.md#pilot-operating-gate) |
| Merchant training: order, 86, pause, chat, cancel, settlement | Owner/ops | [01 pilot operating gate](01-pilot-safety-release.md#pilot-operating-gate) |
| Rider cohort for one zone/window | Owner/ops | [01 pilot operating gate](01-pilot-safety-release.md#pilot-operating-gate) |
| Shift checklist and named support owner | Owner/ops | [01 pilot operating gate](01-pilot-safety-release.md#pilot-operating-gate) |
| Weekly merchant statements and cash hand-ins | Built/prove | [04 § A/F](04-payments-support-cash.md#slice-a--executable-money-path-proof) |
| Hard driver COD debt ceiling | Planned | [04 § E](04-payments-support-cash.md#slice-e--driver-cod-exposure-ceiling) |
| Hotel/restaurant/referral/founder acquisition | Planned + owner | [05 § D/G](05-tourist-trust-growth.md#slice-d--acquisition-attribution) |
| Paid acquisition held until evidence | Deferred by gate | [05 § E/G](05-tourist-trust-growth.md#slice-e--conversion-and-retention-measurement) |
| Post-delivery app-store review | Planned | [05 § F](05-tourist-trust-growth.md#slice-f--app-store-review-prompt) |
| Source of every customer/order | Planned | [05 § D](05-tourist-trust-growth.md#slice-d--acquisition-attribution) |
| Gate: 50 delivered, service/money/support targets | Owner/ops evidence | [01 pilot operating gate](01-pilot-safety-release.md#pilot-operating-gate), [04 acceptance](04-payments-support-cash.md#acceptance) |

## Phase 2 — second-order engine

| Roadmap commitment | Status | Specification / acceptance |
|---|---|---|
| Preserve canonical modifier IDs | Built | [02 current evidence](02-second-order-and-saved-intent.md#current-evidence) |
| Rebuild basket/quantities/modifiers/notes | Built/partial; harden | [02 § A](02-second-order-and-saved-intent.md#slice-a--authoritative-cart-preparation) |
| Revalidate price/stock/store/minimum | Planned shared RPC | [02 § A](02-second-order-and-saved-intent.md#slice-a--authoritative-cart-preparation) |
| Explain removed/changed items before checkout | Planned | [02 § A](02-second-order-and-saved-intent.md#slice-a--authoritative-cart-preparation) |
| Home/Orders “Order again” entry | Built; verify | [02 current evidence](02-second-order-and-saved-intent.md#current-evidence) |
| Reorder impression-to-delivery analytics | Planned | [02 acceptance](02-second-order-and-saved-intent.md#acceptance-gate) |
| Consented 7/14-day reminder | Planned after Package 03 | [02 § E](02-second-order-and-saved-intent.md#slice-e--lifecycle-reminders-and-simple-recommendations), [03 § G](03-notifications-and-crm.md#slice-g--lifecycle-crm) |
| Merge guest/server favorites without loss | Built/partial; offline removal hardening planned | [02 § B](02-second-order-and-saved-intent.md#slice-b--harden-guest-and-offline-favourite-merge) |
| Real notification controls | Built (migs 142/143, `expo-push` v15, prod-verified 2026-07-27) | [03 § A status](03-notifications-and-crm.md#slice-a-status) |
| Consent provenance, quiet hours, locale | Partial — quiet hours built and corrected; consent **event trail** (A3) still missing | [03 § A3](03-notifications-and-crm.md#a3-consent-model) |
| Server campaign consent enforcement | Built/partial; harden | [03 § A4](03-notifications-and-crm.md#a4-campaign-enforcement-and-operator-truth) |
| Frequency caps and unsubscribe | Planned | [03 § G](03-notifications-and-crm.md#slice-g--lifecycle-crm) |
| Gate: second-order, consent and campaign attribution | Planned measurement | [02 acceptance](02-second-order-and-saved-intent.md#acceptance-gate), [03 acceptance](03-notifications-and-crm.md#acceptance-gate) |

## Phase 3 — proper notifications and loved items

| Roadmap commitment | Status | Specification / acceptance |
|---|---|---|
| Durable ticket IDs and truthful states | Planned | [03 § C–D](03-notifications-and-crm.md#slice-c--durable-push-outbox-and-attempts) |
| Expo receipt polling | Planned | [03 § E](03-notifications-and-crm.md#slice-e--receipt-poller) |
| Dead-token pruning and bounded retry | Partial/planned | [03 § D–E](03-notifications-and-crm.md#slice-d--sender-ticket-storage-and-retries) |
| Stop calling HTTP 2xx delivered | Planned correction | [03 § A4](03-notifications-and-crm.md#a4-campaign-enforcement-and-operator-truth) |
| Test send, draft, scheduling, failure detail | Planned | [03 § A4/G](03-notifications-and-crm.md#a4-campaign-enforcement-and-operator-truth) |
| Allow-listed payload routes | Partial/planned | [03 § F](03-notifications-and-crm.md#slice-f--notification-open-attribution) |
| Notification inbox after transport | Deferred by gate | [03 § H](03-notifications-and-crm.md#slice-h--notification-inbox-last) |
| Menu-item favorites and Saved screen | Planned | [02 § C](02-second-order-and-saved-intent.md#slice-c--menu-item-favourites-and-saved-screen) |
| Separate restaurant/item favorites | Planned | [02 § C](02-second-order-and-saved-intent.md#slice-c--menu-item-favourites-and-saved-screen) |
| Cross-device saved sync and offline merge | Partial/planned | [02 § B–C](02-second-order-and-saved-intent.md#slice-b--harden-guest-and-offline-favourite-merge) |
| Reopened/back-in-stock/real offer triggers | Planned after outbox | [03 § G](03-notifications-and-crm.md#slice-g--lifecycle-crm) |
| Cross-device cart snapshots | Planned | [02 § D](02-second-order-and-saved-intent.md#slice-d--server-backed-active-cart) |
| Safe abandoned-cart reminder | Planned | [02 § E](02-second-order-and-saved-intent.md#slice-e--lifecycle-reminders-and-simple-recommendations), [03 § G](03-notifications-and-crm.md#slice-g--lifecycle-crm) |
| Explainable recommendations, no premature AI | Planned | [02 § E](02-second-order-and-saved-intent.md#slice-e--lifecycle-reminders-and-simple-recommendations) |

## Phase 4 — cards and public launch

| Roadmap commitment | Status | Specification / acceptance |
|---|---|---|
| Entity/bank/tax, Paymob KYC, accounting | Owner gate | [04 § B](04-payments-support-cash.md#slice-b--controlled-card-rollout) |
| Deployed intention/webhook HMAC | Built/partial; prove | [04 § B](04-payments-support-cash.md#slice-b--controlled-card-rollout) |
| Idempotency and replay | Built/partial; prove | [04 § A/B](04-payments-support-cash.md#slice-a--executable-money-path-proof) |
| Success/failure/abandon/timeout/delayed callback | Planned proof | [04 § A/B](04-payments-support-cash.md#slice-a--executable-money-path-proof) |
| Full refund | Built/prove | [04 current evidence](04-payments-support-cash.md#current-evidence) |
| Partial refund | Planned | [04 § C](04-payments-support-cash.md#slice-c--partial-refunds-and-order-adjustments) |
| Gateway/order/refund/settlement reconciliation | Planned | [04 § A](04-payments-support-cash.md#slice-a--executable-money-path-proof) |
| Flag remains off until 20 controlled transactions | Planned gate | [04 § B](04-payments-support-cash.md#slice-b--controlled-card-rollout) |

## Phase 5 — operating scale

| Roadmap commitment | Status | Specification / acceptance |
|---|---|---|
| Support cases with status/owner/SLA/outcome | Planned | [04 § D](04-payments-support-cash.md#slice-d--support-cases-and-sla) |
| Restaurant/rider incident playbooks and on-call | Owner/ops + alert framework | [01 § 5](01-pilot-safety-release.md#5-deliberate-monitoring-exercise), [04 § F](04-payments-support-cash.md#slice-f--settlement-and-finance-exception-operations) |
| COD threshold enforcement | Planned | [04 § E](04-payments-support-cash.md#slice-e--driver-cod-exposure-ceiling) |
| Weekly settlement automation/exception/sign-off | Planned | [04 § F](04-payments-support-cash.md#slice-f--settlement-and-finance-exception-operations) |
| Unit economics by order/zone/merchant/source/ownership | Partial/planned | [04 § F](04-payments-support-cash.md#slice-f--settlement-and-finance-exception-operations), [05 § D](05-tourist-trust-growth.md#slice-d--acquisition-attribution), [06 scorecard](06-cloud-kitchen.md#analytics-and-operating-scorecard) |
| Merchant scorecard coaching | Score built; operating process owner | [01 pilot operating gate](01-pilot-safety-release.md#pilot-operating-gate) |
| Rider demand planning | Owner/ops using measured dashboards | [01 pilot operating gate](01-pilot-safety-release.md#pilot-operating-gate) |
| Immutable releases, staging restore, migration ledger | Partial/planned | [01 § 1/3](01-pilot-safety-release.md#1-rehearsable-database-restore) |
| Daily/weekly operating dashboards | Partial/planned across packages | [01 § 4](01-pilot-safety-release.md#4-posthog-funnel-proof), [04 analytics](04-payments-support-cash.md#analytics-and-operational-signals), [05 § E](05-tourist-trust-growth.md#slice-e--conversion-and-retention-measurement) |
| Gate: contribution, 100/day, repeat/SLA, weekly reconciliation, operator independence | Owner/ops evidence | [07 Gate 0](07-expansion.md#gate-0--expansion-readiness) |

## Phase 6 — own kitchen

| Roadmap commitment | Status | Specification / acceptance |
|---|---|---|
| Entity/lease/licence/insurance | Owner gate | [06 Stage 0](06-cloud-kitchen.md#stage-0--owner-launch-dossier) |
| Recipe/packaging cost and menu engineering | Planned + owner data | [06 Stage 1](06-cloud-kitchen.md#stage-1--menu-and-cost-truth-before-erp) |
| Fit-out/staff/procurement/waste/food-safety SOP | Owner/ops | [06 Stage 0/4](06-cloud-kitchen.md#stage-0--owner-launch-dossier) |
| Merchant-conflict policy and technical safeguards | Built/verify | [06 fairness](06-cloud-kitchen.md#fair-marketplace-safeguards) |
| Sequential brand launch | Planned gated operation | [06 Stage 6](06-cloud-kitchen.md#stage-6--launch-one-brand-at-a-time) |
| Honest own-brand reporting | Built/verify | [06 scorecard](06-cloud-kitchen.md#analytics-and-operating-scorecard) |
| Counter/dine-in decision | Deferred by legal/materiality gate | [06 Stage 5](06-cloud-kitchen.md#stage-5--counterdine-in-decision) |
| Inventory only after real need | Deferred by data gate | [06 Stage 7](06-cloud-kitchen.md#stage-7--capacity-sourcing-and-waste) |

## Phase 7 — expansion

| Roadmap commitment | Status | Specification / acceptance |
|---|---|---|
| Vertical identity end to end | Partial | [07 Program A](07-expansion.md#program-a--make-vertical-identity-load-bearing) |
| Decimal/minor-unit/weighted pricing | Planned foundational RFC | [07 Program B](07-expansion.md#program-b--money-precision-rfc-before-grocery) |
| Grocery catalog, stock, bulk import | Planned | [07 C1–C2](07-expansion.md#program-c--grocery) |
| Grocery measured fulfillment/substitutions | Planned | [07 C3–C4](07-expansion.md#c3-basket-preparation-and-final-price) |
| Grocery picker and vertical UX | Planned | [07 C5–C6](07-expansion.md#c5-picker-role) |
| Pharmacy legal gate | Owner/legal | [07 D0](07-expansion.md#d0-legal-gate) |
| Prescription upload/pharmacist approval | Planned behind legal gate | [07 D2–D3](07-expansion.md#d2-prescription-evidence) |
| Age/restricted/audit/return controls | Planned behind legal gate | [07 D1–D4](07-expansion.md#d1-product-classification) |
| First-class city model | Planned | [07 Program E](07-expansion.md#program-e--city-dimension) |
| City-specific supply/ops/go-live | Owner/ops + planned gate | [07 city-two gate](07-expansion.md#city-two-go-live-gate) |

## Quick-win queue audit

| Quick win | Covered by |
|---|---|
| PostHog production build/full funnel | 01 E, 05 E |
| COD lifecycle, settlement and restore | 01 A/B, 04 A |
| Honest currency | 05 A/B |
| Real notification preferences | 03 A/B |
| Guest favorites merge | 02 B |
| Exact reorder/modifiers | 02 A |
| App-store review prompt | 05 F |
| `/version.json`/SHA drift | 01 C |
| Deliberate ops alert | 01 F |
| Driver COD debt limit | 04 E |

## Explicit deferrals audit

| Not-now decision | Enforced in plan |
|---|---|
| Inbox before receipts/preferences | 03 H depends on A–G |
| Opaque AI before explainable signals | 02 F |
| Public cards before reconciliation/refunds | 04 B acceptance gate |
| Grocery/pharmacy before food proof | 07 Gate 0 |
| City two before operator independence | 07 Gate 0 / Program E |
| Paid growth before conversion/repeat | 05 E/G |
| All restaurants at once | 01 pilot operating gate |

## Completeness verdict

Every feature and operating gate in the A-to-Z roadmap has an owner and a
specification/acceptance location. The only intentionally unresolved inputs are
real owner/legal/commercial facts: restore destination, security dashboard
controls, Paymob/KYC/tax details, kitchen lease/licensing/quotes/staff/suppliers,
pharmacy legal advice, and the chosen second city. The specs fail closed around
those inputs rather than guessing them.
