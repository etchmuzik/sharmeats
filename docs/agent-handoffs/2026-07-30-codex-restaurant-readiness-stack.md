# Restaurant-readiness integration stack

Date: 2026-07-30

Branch: `codex/restaurant-readiness-ready`

Worktree: `/Users/etch/Downloads/sharmeats-codex-ready`
Base: `c16d5fda77ebae61aeccf55f68393ff5dd5f0d1c`

## Purpose

This is the clean integration branch for the restaurant-readiness and
high-value quick-win work. It is based directly on Claude's latest committed
Package 08 Slice C head, so Slice C is not duplicated in this branch's history.
The earlier tested assembly branch
`codex/restaurant-readiness-stack` is byte-for-byte identical at its feature
tip, but this branch is the one Claude should review and integrate.

No commit was merged into `main`, no production migration was applied, and no
app or Edge Function was deployed.

## Six product layers covered

### 1. Customer

- Five primary tabs: Home, Browse, Cart, Orders, Profile.
- Scheduled checkout is fail-closed behind the production-disabled lifecycle
  gate.
- Optional COD tender/change request accepts Arabic-Indic digits.
- Latest-arrival credit copy shows the exact deadline.
- Package 07 catalog search uses the bounded server RPC, cap-independent UUID
  keyset hydration, explicit partial-failure recovery, and fail-closed mocks.

### 2. Restaurant

- Typed EN/AR operational dictionary, persistent language selection, and RTL
  layout for the high-frequency kitchen flow.
- Safe localized operational errors; raw backend diagnostics go only to crash
  reporting.
- Localized logo feedback and a hydration guard that cannot overwrite a fresh
  in-session language choice.

### 3. Driver

- Typed EN/AR core-shift experience with persisted locale and background-safe
  Android tracking notification copy.
- Localized recovery messages for sign-in, online state, offers, jobs,
  location, and avatar upload.
- Versioned customer-to-driver cash-change marker. The driver strips the marker
  and renders localized change instructions, including when no drop-off
  preference was selected.

### 4. Merchant

- Manager-only CSV template, parse/validation preview, row-level errors, and
  atomic import.
- All direct and bulk section/item mutations share the same semantic
  per-restaurant lock.
- Server-side append ordering and durable manager/staff/admin/cross-tenant,
  duplicate, ordering, and rollback SQL coverage.
- Exact generated DB signatures for all three new merchant RPCs.

### 5. Admin / operations

- Shared operational header and grouped navigation.
- Dispatch remains the primary action; Restaurant, Finance, Growth, and Support
  destinations are easier to scan on desktop and mobile.
- Existing destination authorization remains authoritative.

### 6. Database governance

- Package 07 lifecycle producers and vertical transitions now share a tested
  lock protocol without the original visibility race or user-row deadlock.
- Cancellation/error paths release scoped session locks before pooled
  connections can retain them.
- `vertical_not_visible` is an allowed suppression reason.
- Grocery/pharmacy cannot be stored as food cuisines through direct SQL, stale
  clients, or admin/onboarding RPCs.
- The existing security CI command now runs the merchant regression and a
  deterministic production-contract Package 07 fixture, functional assertions,
  and real two-session dblink races.

## Integrated verification

- Customer: typecheck passed; 48 files / 497 tests passed.
- Restaurant: typecheck passed; 6 files / 50 tests passed.
- Driver: typecheck passed; 7 files / 50 tests passed.
- Merchant: typecheck and lint passed; 10 files / 76 tests passed; production
  build passed with process-only public Supabase placeholders.
- Admin: typecheck and lint passed; production build passed with process-only
  public Supabase placeholders.
- `scripts/test-security-migrations.sh`: passed end to end, including merchant
  security/rollback coverage and Package 07 functional, concurrency, and real
  grant lock-order assertions.
- Generated database-types contract test: passed.
- Independent Package 07 and final integrated-stack reviews: clean after all
  findings were repaired.
- `git diff --check`: passed.
- Clean ancestry proof: the tested assembly and this branch had no tree diff
  before this handoff-only commit.

## Release order

1. Review and integrate `codex/restaurant-readiness-ready`.
2. Follow `docs/DATABASE-RELEASE-RUNBOOK.md`, including backup/advisor checks.
3. Apply server changes before clients:
   - `20260730162500_atomic_merchant_menu_import.sql`
   - `20260730162600_p07_governance_hardening.sql`
4. Run the linked SQL assertions against the integration database and regenerate
   DB types after the real apply to confirm there is no production drift.
5. Smoke test merchant import with owner/manager and staff accounts.
6. Perform Arabic device acceptance on the target restaurant tablet and driver
   Android device before store rollout.

## Intentionally still closed or deferred

- Scheduled ordering stays disabled until the lifecycle/operations contract is
  explicitly approved.
- Grocery and pharmacy remain private; this stack does not activate or advertise
  them.
- Merchant CSV v1 excludes modifiers.
- Driver History, Tier, KYC, and chat bodies remain English outside the
  high-frequency shift scope.
- Arabic operational wording still needs a native-speaker kitchen review,
  TalkBack pass, and narrow-device/tablet layout check.
- Package 07 still lists private-access `used` event writing, campaign vertical
  dimension, and future private-vertical browse/copy as later work.

## Detailed handoffs

The individual implementation and review records are all under
`docs/agent-handoffs/`, especially:

- `2026-07-30-codex-customer-catalog-search-p07.md`
- `2026-07-30-restaurant-arabic-core.md`
- `2026-07-30-driver-arabic-core.md`
- `2026-07-30-merchant-menu-csv-import.md`
- `2026-07-30-codex-p07-governance-hardening.md`
- `2026-07-30-codex-integration-review-fixes.md`
- `2026-07-30-codex-final-audit-closures.md`
