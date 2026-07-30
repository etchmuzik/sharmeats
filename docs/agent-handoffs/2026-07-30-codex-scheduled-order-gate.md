# Codex handoff — fail-closed scheduled-order release gate

**Date:** 2026-07-30
**Agent:** Codex
**Branch:** `codex/customer-scheduling-gate`
**Worktree:** `/Users/etch/Downloads/sharmeats-codex-ux`
**Base:** `e32a42f` (`feat(restaurant): P06 Stage 3 — brand tag on the ticket detail screen`)

## Why this slice

Checkout generated eight arbitrary half-hour choices from the device clock. The
choices were not constrained by restaurant operating hours. The database stores
`scheduled_for`, but the current acceptance, kitchen-progression and dispatch
automation does not yet provide a complete delayed-release lifecycle for that
promise.

That combination can show a customer “later” while operational automation starts
moving the order now. This slice keeps scheduling dark until the full lifecycle
is proven.

## What changed

- Added `EXPO_PUBLIC_SCHEDULED_ORDERS_ENABLED`, fail-closed unless its exact
  value is `true`.
- Set the production EAS profile explicitly to `false`.
- Hidden the entire checkout timing-choice card while the flag is off. Because
  ASAP is then the only truthful mode, no redundant one-option card is shown.
- Gated the actual `place_order` input and the `order_placed.scheduled`
  analytics property with the same effective value. This is not a cosmetic-only
  gate: a hidden/stale client value cannot reach the backend.
- Preserved all existing scheduling UI and request wiring behind the flag so it
  can be re-enabled after the backend work lands.

## Files

- `apps/customer/src/lib/scheduledOrders.ts`
- `apps/customer/src/lib/scheduledOrders.test.ts`
- `apps/customer/app/checkout.tsx`
- `apps/customer/eas.json`

## Verification

Run from `apps/customer`:

```bash
npm run typecheck
npm test
```

Verified in this worktree:

- TypeScript: pass
- Vitest: 43 files, 468 tests passed
- Focused scheduling-flag suite: 3 tests passed
- `git diff --check`: pass

## Re-enable gate

Do not set the flag to `true` until all of these exist and are production-tested:

1. authoritative regular hours and special closures per restaurant;
2. server validation that the requested slot is orderable;
3. scheduled orders separated from immediate kitchen work;
4. acceptance/preparation released at the correct lead time;
5. driver dispatch held until the correct pickup window;
6. cancellation and customer messaging for a restaurant that becomes unavailable.

## Integration notes

- No migration, edge function, restaurant app, merchant app, admin app, or
  Package 06 file was changed.
- Claude's `main` worktree remains untouched.
- This commit is intentionally independent of the customer-navigation commit;
  either can be cherry-picked without the other.
