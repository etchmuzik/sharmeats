# Claude expansion review and implementation handoff

Copy the prompt below into Claude from the Sharm Eats repository. It is a
multi-session program controller, not permission to implement every package in
one turn.

---

You are reviewing and implementing the Sharm Eats expansion program for
grocery, pharmacy/health and delivery as a service.

## Required reading, in order

1. `CLAUDE.md`
2. `docs/implementation-program/README.md`
3. `docs/implementation-program/EXPANSION-OWNER-DECISIONS.md`
4. `docs/implementation-program/07-expansion.md`
5. `docs/implementation-program/08-delivery-as-a-service.md`
6. `docs/implementation-program/TRACEABILITY.md`
7. `docs/DATABASE-RELEASE-RUNBOOK.md`
8. `docs/implementation-program/01-pilot-safety-release.md` and
   `docs/implementation-program/04-payments-support-cash.md` for
   release/payment gates
9. current `git status`, recent commits, migration ledger, target code and
   deployed production function/policy definitions

Older roadmaps/audits are evidence, not implementation authority. The current
worktree, production database/functions and the two package specs above are the
baseline.

The owner reports that licences and legal papers exist. Treat them as available
inputs: create a restricted metadata/evidence register and control map, but
never commit confidential scans, document bodies, identity numbers, policy
numbers or signatures. Missing evidence mapping blocks activation, not dark
schema/application work.

## Product decisions already made

- Grocery and pharmacy are commerce verticals.
- “Send”/delivery as a service is a separate `delivery_jobs` product.
- Never create a fake courier restaurant/order/menu item.
- First grocery is fixed-pack, whole-EGP, COD, 50–200 SKUs and private.
- No measured weights, substitutions or live-stock promise in grocery v1.
- First health assortment is server-allow-listed; unknown classification fails
  closed. Rx stays disabled until the complete pharmacy controls pass.
- Rx recipient/patient authority is server-bound to the immutable pharmacist
  review, authorization, order snapshot and handoff; an unmapped proxy fails
  closed.
- Delivery launches admin/internal → verified merchant → customer Send.
- Delivery v1 is one pickup, one drop-off, one sealed parcel, no driver
  purchasing, no contents COD/cash-on-behalf, manual dispatch and one active
  food-or-parcel job per driver.
- Merchant parcel fees use a capped invoice/prepaid ledger. Customer Send waits
  for the Package 04 card/refund/reconciliation gate.
- Every feature uses server-authoritative staged launch and starts dark:
  commerce verticals use `disabled/private/public`; delivery uses
  `disabled/internal/merchant_private/customer_private/public` plus
  `closed/open/draining` intake.
- All testing and verification sections in Packages 07/08 are mandatory.

Do not reopen these choices merely because another architecture is possible.
Flag only a real contradiction with current production or the mapped legal/
insurance evidence.

## Work one end-to-end activation slice at a time

Default sequence:

| Session | Assignment | Activation |
|---:|---|---|
| E0 | Package 07 Program A: fail-closed vertical launch authority and end-to-end vertical identity | Dark/private only |
| E1 | Package 07 C0: fixed-pack grocery catalog/import/search/order snapshot/UX | Named private cohort |
| E2 | Package 08 internal vertical slice across Slice 0/A–I: Sharm bridge, dark config, internal quote/job, manual dispatch/shared capacity, proof/return, minimum private communication/notification, zero-fee + driver-earning ledger, admin/driver UX and ops | Internal only |
| E3 | Package 08 merchant extension across A–I: merchant eligibility/request, communication, durable notifications, capped invoice/prepaid finance, merchant/admin/driver UX and operations | Verified merchant cohort |
| E4 | Package 07 D0/D0.5/D1: evidence register, server classification and health catalog | Private; exact mapped scope |
| E5 | Package 08 customer Send extension across A–I, including card/refund, SMS, customer UX and operations | Private after Package 04 gate |
| E6 | Package 07 Program B/C1–C6: full grocery money/inventory/weight/substitution | Later grocery gate |
| E7 | Package 07 D2–D4: prescription/pharmacist/delivery controls | Dark until full pharmacy sign-off |
| E8 | Package 07 Program E: city dimension and city-two private launch | Later city gate |

Unless the owner explicitly names another row, implement **E0 only**. Do not
start E1–E8 in parallel against `main`.

## First response: review verdict

Before editing or mutating production, return a concise table:

| Requirement | Repository state | Production state | Spec correction | Planned change/test |
|---|---|---|---|---|

For the selected session:

1. prove what is built, partial or absent;
2. identify dirty/concurrent files and work around them;
3. find every public read/RPC/Edge Function/Realtime/job path affected;
4. fetch current deployed definitions for replaced policies/functions;
5. challenge schema, RLS, async, money, privacy and old-binary assumptions;
6. list exact migrations/files/tests/deployments;
7. state whether the session is dark, private or deployable;
8. stop before mutation only if a real owner choice would change money,
   liability, eligibility or public behavior.

Do not review a migration another session is still editing. Refresh migration
numbers immediately before creating one.

## Implementation discipline

1. Preserve all unrelated dirty/untracked files; never stage them.
2. Write failing tests or executable SQL assertions before authority behavior.
3. Build replaced functions from current production `pg_get_functiondef`, not
   the migration that originally created them.
4. Use additive, backward-compatible migrations and one function signature.
5. Every new public table gets explicit grants and RLS. Do not assume Supabase
   auto-exposes it.
6. Every `SECURITY DEFINER` function has pinned `search_path`, internal
   authorization, `REVOKE ... FROM PUBLIC`, narrow grants and negative tests.
7. Server authority owns launch state, catalog eligibility, prices, quote,
   transitions, OTP, assignment, capacity, payments, refunds and finance.
8. App controls mirror permissions but never replace database enforcement.
9. Customer-visible changes ship together in EN/AR/RU/IT/DE with RTL checks.
10. Preserve old food binaries and prevent unknown delivery payloads routing to
    food orders.
11. Use allow-listed analytics/events with no phone, address, prescription,
    parcel free text, OTP, proof URL or confidential evidence.
12. Deploy server/data compatibility before UI exposure; start disabled/private.
13. Commit each coherent slice, push it, and record the exact production state.

For database work:

- test fresh install and production-shaped upgrade;
- run the local security harness;
- run a real-schema `BEGIN … ROLLBACK` dry run with functional assertions;
- regenerate `packages/db-types/database.types.ts`;
- run database/security advisors before/after;
- follow the release runbook because the migration ledgers have diverged;
- apply only after tests and the target file/function are no longer being edited
  by another session.

## Required verification

Use the complete matrix in the selected package. At minimum, do not finish
without:

- migration fresh/upgrade, transaction-dry-run rollback, isolated restore and
  feature-close/drain/forward-correction evidence; never require a destructive
  production down migration;
- positive and negative RLS/RPC/Storage tests for every role and cross-tenant
  path;
- direct-ID, stale client, guessed UUID and old-binary bypass tests;
- state/idempotency/concurrency/property tests;
- money/custody reconciliation;
- all affected app tests, typecheck, lint and production builds;
- five locale key parity and Arabic RTL;
- E2E happy and every enabled exception path;
- physical Android/iOS, push/deep-link, offline/poor-network/restart tests;
- performance/query-plan and pilot-load evidence;
- dashboards/alerts and deliberate failure exercise;
- dark/private production smoke plus close/rollback rehearsal.

If a physical-device, owner-paper or operating rehearsal cannot be executed in
the session, implement and verify everything else, leave activation off, and
record the exact owner-run evidence step. Do not label it passed.

## Session E0 acceptance

E0 is complete only when:

- food is backfilled to current public behavior with no regression;
- grocery/pharmacy remain server-disabled/private;
- public merchant/menu list and direct-ID reads, browse/search, fee quote,
  authoritative cart preparation, `place_order`, promotions, notifications,
  reorder/saved-cart, Realtime and caches all honor vertical stage;
- private access is user-scoped, revocable/expiring and cannot leak;
- vertical/catalog fields survive generated types, mappers, repositories,
  admin/merchant models, immutable order snapshots and analytics;
- merchant/admin vertical assignment is audited and incompatible live changes
  fail;
- anon/cross-user/cross-merchant/stale-client/old-binary tests fail closed;
- food E2E/typecheck/tests/builds pass;
- production is dark/private and the close switch is proven.

Do not add grocery screens in E0 unless needed to prove the private contract.

## End-of-session report

Return:

- review verdict and spec corrections;
- migrations/files/functions/policies changed;
- exact test/query/build/device commands and pass/fail counts;
- database advisor delta;
- migration dry-run/apply status;
- Edge Function/deployment versions;
- production smoke and feature stage;
- compatibility and rollback proof;
- confidential evidence mapping status without secret contents;
- owner/manual actions still required;
- acceptance checklist with evidence links;
- what remains in the current session row and the recommended next row;
- commit SHA, push state and a clean/dirty file ownership summary.

Never declare an expansion slice complete from typecheck, a happy-path order or
an HTTP 2xx alone.

---

## Recommended first message after Claude reads the prompt

> Implement E0 only: Package 07 Program A, the fail-closed vertical authority
> and end-to-end vertical identity. Review current repo and production first,
> preserve unrelated work, run the complete verification matrix, keep grocery
> and pharmacy private, and commit/push only the coherent E0 slice.
