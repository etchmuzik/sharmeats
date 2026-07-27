# Sharm Eats implementation program

**Purpose:** convert
[`BUSINESS-ROADMAP-2026-07-27.md`](../BUSINESS-ROADMAP-2026-07-27.md) into
reviewable, implementation-ready work for Claude.

This directory is the engineering source of truth for planned work. The
business roadmap still owns sequencing and operating gates; these documents own
interfaces, files, migrations, tests, rollout and acceptance.

## Current-state corrections

Claude must start from the worktree and production, not from older audits.

Already implemented:

- Saved Orders: migration 086, repositories, delivered-order save card and Home
  rail.
- Reorder modifier identity: migration 055 snapshots `optionId` and
  `modifierId`; current orders can be reconstructed without dropping add-ons.
- Guest/returning-account restaurant favourites merge at sign-in in commit
  `0173832`; a durable offline-removal tombstone/queue still needs hardening.
- Customer OTA/runtimeVersion configuration across all three mobile apps.
- Full card-refund backend primitives: `order_refunds`,
  `paymob-refund`, and `finalize_full_card_refund`.
- Driver cash ledger, cash hand-in UI, merchant settlement functions, customer
  credit wallet and admin credit UI.
- Static approximate multi-currency display. It is not a live FX system.
- PostHog key in the customer production build profile. It still needs a fresh
  device build and a real ingested-event verification.
- Unattended database and Storage backups in commit `2dc7027`; restore rehearsal
  and encrypted off-machine retention remain open.

Implemented and live on 2026-07-27:

- migration 136 merchant staff enforcement;
- migration 137 push routing/campaign transport outcome;
- migration 138 marketing opt-in, quiet hours and server campaign filtering;
- `expo-push` v14.

Migration 138 was committed and applied while this program was being authored.
It is live but **not the final notification design**. The mandatory correction
gate in [`03-notifications-and-crm.md`](03-notifications-and-crm.md) remains:
the UI persists a transactional switch the senders ignore, and
`in_quiet_hours()` is declared `IMMUTABLE` even though it reads `now()`.
Transport “delivered” naming also remains to be corrected.

## Program order

| Order | Package | Why now |
|---:|---|---|
| 1 | [Pilot safety and release truth](01-pilot-safety-release.md) | Prove recovery, money flow, monitoring and exactly what code is live |
| 2 | [Second-order and saved intent](02-second-order-and-saved-intent.md) | Highest-leverage revenue loop; extends existing reorder/saved-order work |
| 3 | [Notifications and CRM](03-notifications-and-crm.md) | Consent first, then receipts/retries and lifecycle messaging |
| 4 | [Payments, support and cash operations](04-payments-support-cash.md) | Prove existing rails, then close partial-refund/support/cash-limit gaps |
| 5 | [Tourist trust, currency and measurable growth](05-tourist-trust-growth.md) | Remove misleading copy and make the tourist wedge measurable |
| 6 | [Cloud-kitchen operating package](06-cloud-kitchen.md) | Separate capex/food operation behind evidence gates |
| 7 | [Verticals and city expansion](07-expansion.md) | Real product programs, explicitly gated after Sharm food proof |

## Shared implementation rules

Every Claude implementation session must obey these rules:

1. **Inspect first.** Read `git status`, recent commits, the target files and
   current production definitions. Do not rely on the migration that originally
   created a function if production has since replaced it.
2. **Do not collide.** Dirty files belong to the user or another session.
   Coordinate or work around them; never overwrite or stage unrelated changes.
3. **One function signature.** Replace the current RPC body; do not create an
   overload unless the design explicitly requires a new API.
4. **Database migration safety.**
   - create new migration files with the repository/Supabase migration workflow;
   - derive replaced functions from `pg_get_functiondef` in production;
   - run a real-schema `BEGIN … ROLLBACK` dry run with functional assertions;
   - run the local security harness;
   - regenerate `packages/db-types/database.types.ts`;
   - use the release runbook because the linked migration ledger is divergent.
5. **Data API security.** Every new `public` table gets explicit grants, RLS and
   owner/admin policies. Do not assume new tables are automatically exposed.
6. **Definer security.** `SECURITY DEFINER` requires an explicit
   `search_path`, internal authorization, `REVOKE ... FROM PUBLIC`, narrow
   grants and a negative cross-user test.
7. **No fake controls.** A visible switch/button must persist and be enforced
   by the server, or it must be clearly read-only.
8. **Money is server-authoritative.** Clients never choose prices, refunds,
   settlement amounts, FX charge amounts or commission.
9. **Localization is part of done.** Customer-visible copy ships in
   EN/AR/RU/IT/DE; Arabic layout is tested RTL.
10. **Every release is observable.** Add analytics for the intended outcome,
    errors for the failure path, and operator visibility for asynchronous work.
11. **Compatibility is explicit.** Document old-binary behavior and deploy
    order for every contract change.
12. **Claims match evidence.** “Accepted by Expo” is not “received by device”;
    “receipt ok” is only handoff to APNs/FCM, not proof the user saw it.

## Definition of ready for implementation

A package is ready when its spec identifies:

- current behavior and evidence;
- desired user/operator behavior;
- data model and authority boundary;
- exact repository surfaces expected to change;
- migration/RPC/edge-function requirements;
- analytics and operational signals;
- security/privacy rules;
- unit, integration, RLS, E2E and device tests;
- rollout order, compatibility and rollback;
- measurable acceptance criteria;
- owner-only inputs or approvals.

## Definition of done

Claude may mark a package done only when:

- every acceptance item is backed by a test, query, device observation or
  production artifact;
- database advisors/lint show no new relevant findings;
- all affected apps typecheck/test/lint/build;
- five-language and RTL checks pass where customer copy changed;
- production deployment is verified when deployment was requested;
- release notes/runbook and generated types are updated;
- the work is committed/pushed without unrelated user files.

## Traceability to the business roadmap

The exhaustive row-by-row audit is
[`TRACEABILITY.md`](TRACEABILITY.md). The compact ownership map is:

| Business-roadmap outcome | Engineering package |
|---|---|
| Restore, lifecycle, monitoring, PostHog, version truth, device matrix | 01 |
| Exact Order Again, guest merge, saved items, server cart, simple recommendations | 02 |
| Consent, quiet hours, receipts, retry, campaign truth, lifecycle messaging, inbox | 03 |
| COD/card/refund/settlement proof, support cases, cash ceiling, scale controls | 04 |
| Honest currency, live-rate option, review prompt, attribution and release copy | 05 |
| Own-brand menus, costing, food ops and launch gates | 06 |
| Vertical foundation, grocery, pharmacy and city dimension | 07 |

## Claude entry point

Give Claude
[`CLAUDE-REVIEW-AND-IMPLEMENT.md`](CLAUDE-REVIEW-AND-IMPLEMENT.md), then name
exactly one package. Do not ask one session to implement all seven packages in
parallel against `main`.
