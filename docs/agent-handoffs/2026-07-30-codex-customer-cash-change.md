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
- A valid amount is converted into an exact driver instruction using the
  existing `dropoff_note`, for example:
  `Cash: customer will pay 600 EGP; bring 28 EGP change.`
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
- Vitest: 43 files, 473 tests passed
- Focused cash-change suite: 8 tests passed
- `git diff --check`: pass

## Integration notes

- No database or RPC change: the delivery instruction uses the existing
  snapshotted `dropoff_note` that already reaches the assigned driver.
- No Package 06, restaurant, merchant, admin, or Claude `main` file changed.
- The generated operational sentence is intentionally English because the
  driver app is currently English-only. The restaurant-Arabic workstream is
  separate; when driver localization lands, this instruction should become
  structured data or be localized at render time.
- This commit is independent from the navigation and scheduled-order gate
  commits and can be cherry-picked on its own.
