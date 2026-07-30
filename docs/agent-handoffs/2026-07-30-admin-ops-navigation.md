# Admin operations navigation handoff — 2026-07-30

## Summary

Implemented the admin navigation quick win on the isolated branch
`codex/admin-ops-nav`. The previous dispatch header presented ten routes as
equal buttons, while each subpage recreated a different subset. All
authenticated admin pages now use one reusable, pathname-aware operational
header.

No migrations, Supabase functions, auth policies, or non-admin surfaces were
changed.

## Product decisions

- Dispatch remains the primary, first navigation action.
- Restaurant work is grouped as Onboarding, Menus, KYC review, Scorecards, and
  Founding rates.
- Finance is grouped as Restaurant settlements, Driver payouts, and Cash
  reconciliation.
- Growth and Support remain direct destinations because each currently has one
  real route. No placeholder “System” destination was invented.
- Desktop uses compact native disclosure menus. Mobile uses one native
  disclosure containing clearly labelled groups, so the sticky header does not
  become a row of tiny or horizontally scrolling targets.
- The active route is exposed visually and with `aria-current="page"`.
- Existing page auth/role gates and sign-out behavior are unchanged.
- The menu editor's “All restaurants” context action is retained inside the
  shared header.

## Files

- `apps/admin-web/src/app/AdminHeader.tsx`
- `apps/admin-web/src/app/page.tsx`
- `apps/admin-web/src/app/menu/page.tsx`
- `apps/admin-web/src/app/onboarding/page.tsx`
- `apps/admin-web/src/app/kyc/page.tsx`
- `apps/admin-web/src/app/scorecards/page.tsx`
- `apps/admin-web/src/app/founding-rates/page.tsx`
- `apps/admin-web/src/app/finance/page.tsx`
- `apps/admin-web/src/app/driver-finance/page.tsx`
- `apps/admin-web/src/app/cash/page.tsx`
- `apps/admin-web/src/app/campaigns/page.tsx`
- `apps/admin-web/src/app/support/page.tsx`

## Verification

Run from `apps/admin-web`:

- `npm run typecheck` — passed
- `npm run lint` — passed with no warnings or errors (only Next.js's existing
  deprecation notice for `next lint`)
- `npm run build` — passed; optimized production build produced a `.next`
  build ID
- `git diff --check` — passed

`npm ci` reported six existing high-severity dependency audit findings. No
dependency or lockfile was changed by this slice.

## Cherry-pick

After this branch is committed, cherry-pick the reported commit hash, or while
the local branch is present:

```bash
git cherry-pick codex/admin-ops-nav
```

## Remaining gaps

- The navigation deliberately does not add universal order/partner search; that
  should be a separate operational feature with real search behavior.
- Route visibility is not filtered by role. This preserves the previous link
  exposure while each destination's existing auth gate remains authoritative.
  If admin roles become more granular, pass capabilities into the shared header
  rather than duplicating page headers again.
- A browser screenshot behind real admin auth was not captured in this isolated
  worktree. Type, lint, and production compilation cover the component and all
  route integrations.
