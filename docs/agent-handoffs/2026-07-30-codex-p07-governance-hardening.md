# Codex handoff — Package 07 governance hardening

Date: 2026-07-30
Branch: `codex/p07-governance-hardening`
Base incorporated: `c16d5fd` (Package 08 migration 193 and generated-type additions)

## Outcome

This branch closes the four actionable findings from the Package 07 peer review
without touching or merging into `main`.

- Timestamp migration
  `supabase/migrations/20260730162600_p07_governance_hardening.sql` avoids the
  sequential Package 08 and merchant migration ranges.
- `abandoned_cart_sweep()` and `reorder_cadence_sweep()` now visit vertical lock
  keys in deterministic order, take a scoped
  `pg_advisory_lock_shared(hashtextextended('vertical:' || id, 0))`, and re-check
  `user_can_view_vertical()` after locking. They release before the
  user-FK decision-ledger write, preserving the existing users → vertical lock
  hierarchy, and explicitly clean up on query cancellation/error. Launch/access
  changes keep their existing exclusive lock.
- `lifecycle_sends_suppression_reason_check` now permits
  `vertical_not_visible`, so both suppression decisions survive in the ledger.
- `private.enforce_package07_private_verticals()` acquires grocery then pharmacy
  transition locks before any repair write, re-checks the rows, and audits real
  changes. It is not exposed to client roles.
- `restaurants.cuisines` is normalized and protected by
  `restaurants_cuisines_food_only`. No restaurant row or food cuisine tag is
  deleted.
- New `public.food_cuisine_type` is the only cuisine input domain for
  `admin_update_restaurant` and `apply_as_restaurant`; the old broad overloads
  are explicitly dropped. The RPC names and JSON argument names remain stable.
- Generated database types expose `food_cuisine_type` for those RPC inputs while
  retaining Claude's migration-193 additions.
- The customer mapper now treats its food vocabulary as a compatibility
  boundary and drops legacy vertical labels or unknown values.

The admin and merchant selectors were already food-only in Package 07 Program A.
The database now makes that UI rule authoritative even for direct SQL, stale
clients, or tampered onboarding drafts.

## Durable tests

- `supabase/tests/20260730162600_p07_governance_hardening.test.sql`
  - enum vocabulary and one-overload RPC shapes;
  - direct-write rejection and legacy normalization;
  - suppression constraint;
  - lock-before-recheck source order;
  - functional ledger rows from both lifecycle producers.
- `supabase/tests/20260730162600_p07_governance_concurrency.test.sql`
  - real two-session `dblink` proof for both producers;
  - producer is observed blocked behind the exclusive transition lock;
  - after the transition commits private, the producer records
    `vertical_not_visible` and never records `would_send=true`.
  - a third race holds the target users row, then calls the real
    `grant_vertical_private_access` users → vertical path while the producer
    reaches its ledger FK; the grant and suppression both complete without a
    deadlock.
- `apps/customer/src/data/supabase/mappers.test.ts`
  - rolling-deployment/stale-row cuisine decoder.

## Verification run

Against a disposable production-shaped PostgreSQL clone through migration 193:

- pre-migration SQL regression failed as expected;
- `BEGIN` → timestamp migration → SQL assertions → `ROLLBACK`: passed;
- rollback proof: `food_cuisine_type` count returned `0`;
- committed migration + SQL assertions: passed;
- two-session concurrency test: passed for both producers and the real
  private-access RPC lock order;
- customer full suite: 42 files / 466 tests passed;
- customer typecheck passed;
- merchant full suite: 6 files / 60 tests passed;
- merchant and admin typechecks passed;
- merchant and admin lint passed;
- merchant and admin production builds passed with temporary process-only
  Supabase build placeholders (no env file written);
- standalone generated database-types TypeScript compile passed;
- `git diff --check` passed.
- independent read-only concurrency/security review: clean after correcting the
  existing users → vertical lock hierarchy and the LockAcquire cancellation
  boundary.

`supabase db lint` connected to the disposable database but could not enable the
local `pgsql_check` extension; this is an environment limitation, not a reported
schema error. Run the linked-project advisors in the normal database release
procedure before production apply.

## Release/integration notes

- No production database, Edge Function, deployment, or `main` worktree was
  mutated.
- Apply server/schema compatibility before clients, following
  `docs/DATABASE-RELEASE-RUNBOOK.md`; migration ledgers remain the release
  authority.
- Grocery and pharmacy remain private. This work does not activate, advertise,
  or add public navigation for either vertical.
- The legacy `cuisine_type` enum deliberately keeps `grocery` and `pharmacy` so
  old payload decoders do not break. The restaurants constraint and narrowed RPC
  domain are the write authority.
- The existing Package 07 open items remain: private-access `used` event writer,
  campaign vertical dimension, and future vertical browse navigation/copy.
