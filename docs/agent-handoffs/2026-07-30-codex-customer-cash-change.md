# Codex handoff — customer COD change request

**Date:** 2026-07-30
**Agent:** Codex
**Branch:** `codex/customer-cash-change`
**Worktree:** `/Users/etch/Downloads/sharmeats-codex-ux`
**Base:** `b144336` (`docs(program): Package 06 record corrected and session deliveries logged`)

## Why this slice

Cash on delivery is the production payment rail, but checkout had no structured
way to tell the driver which note the customer would use. In practice this
creates avoidable calls, failed handoffs, or a driver searching for change at
the hotel gate.

## What changed

- When Cash on delivery is selected, checkout shows one optional field inside
  the existing payment card: the cash amount the customer will hand over.
- The field accepts Western, Arabic-Indic, and Eastern Arabic-Indic digits plus
  common thousands separators.
- An amount below the live order total is rejected inline and disables the
  place-order button.
- A valid amount is encoded as a versioned marker in the existing
  `dropoff_note`, for example:
  `[[sharmeats:cash-change:v1:tender=600;change=28]]`.
- The driver app removes that generated marker and renders a typed EN/AR
  instruction with the exact tender and change amounts. Unknown future marker
  versions remain visible rather than being silently discarded.
- The customer-authored driver note remains first and unchanged.
- Exact cash and an empty optional field add no redundant note.
- The UI copy is present in EN, AR, RU, IT and DE.
- `order_placed` records only the boolean `cashChangeRequested`; it does not
  copy the tender amount into analytics.

## Files

- `apps/customer/src/lib/cashChange.ts`
- `apps/customer/src/lib/cashChange.test.ts`
- `apps/customer/app/checkout.tsx`
- `apps/customer/src/i18n/locales/{en,ar,ru,it,de}.json`

## Verification

Run from `apps/customer`:

```bash
npm run typecheck
npm test
```

Verified in this worktree:

- TypeScript: pass
- Integrated Vitest suite: 48 files, 496 tests passed
- Focused cash-change suite: 9 tests passed
- `git diff --check`: pass

## Integration notes

- No database or RPC change: the delivery instruction uses the existing
  snapshotted `dropoff_note` that already reaches the assigned driver.
- No Package 06, restaurant, merchant, admin, or Claude `main` file changed.
- This integration depends on the driver-side v1 marker parser. Deploy the
  customer writer and driver reader together; older drivers will show the
  marker verbatim, while newer drivers localize it at render time.
- This commit is independent from the navigation and scheduled-order gate
  commits and can be cherry-picked on its own.
