# Codex handoff — customer main-navigation simplification

**Date:** 2026-07-30
**Agent:** Codex
**Branch:** `codex/customer-nav-simplify`
**Worktree:** `/Users/etch/Downloads/sharmeats-codex-ux`
**Base:** `e32a42f` (`feat(restaurant): P06 Stage 3 — brand tag on the ticket detail screen`)

## Why this slice

The customer app had six permanent destinations in its floating tab bar:
Home, Browse, Cart, Orders, Rewards and Profile. Six cramped the compact mobile
navigation and gave a retention feature the same prominence as ordering and
tracking.

This slice deliberately changes navigation only. It does not alter rewards
data, redemption, backend authority, routes, migrations, or Package 06 work.

## What changed

- The persistent bar now contains five frequent destinations:
  Home, Browse, Cart, Orders and Profile.
- Rewards remains fully available from a new row on the Profile/Account screen.
- The Profile tab stays selected while the customer is on the Rewards route.
- Every tab now exposes an explicit `tab` accessibility role, translated label,
  and selected state.
- Navigation definitions and route-selection behavior live in a small pure
  module so they can be regression-tested without mounting React Native.

## Files

- `apps/customer/src/navigation/mainNavigation.ts`
- `apps/customer/src/navigation/mainNavigation.test.ts`
- `apps/customer/src/components/TabBar.tsx`
- `apps/customer/app/(tabs)/profile.tsx`

## Verification

Run from `apps/customer`:

```bash
npm run typecheck
npm test
```

Verified in this worktree:

- TypeScript: pass
- Vitest: 43 files, 471 tests passed
- Focused navigation suite: 6 tests passed
- `git diff --check`: pass

## Integration notes

- No files in `apps/restaurant`, `supabase`, Package 06, or Claude's active
  `main` worktree were changed.
- Cherry-pick this branch's single feature commit when Package 06 has a clean
  integration point.
- The Rewards route intentionally remains under `(tabs)` so existing inbox and
  notification deep links continue to work.
- A later, separate UX slice can evaluate merging Home and Browse. That is not
  included here because removing either destination requires broader discovery
  and cart-entry testing.
