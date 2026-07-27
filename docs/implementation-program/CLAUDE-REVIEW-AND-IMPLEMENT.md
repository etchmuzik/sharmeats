# Claude review and implementation handoff

You are reviewing and implementing one package from the Sharm Eats
implementation program.

## Required reading

1. `CLAUDE.md`
2. `docs/implementation-program/README.md`
3. the selected package specification
4. `docs/DATABASE-RELEASE-RUNBOOK.md` for any database work
5. the current target files and `git status`

Older launch/audit documents are evidence, not authority. Confirm every claim
against the current worktree and, for live database/function behavior,
production.

## Review before implementation

Produce a short verdict table:

| Requirement | Current state | Spec is correct? | Change needed |
|---|---|---|---|

For each requirement:

- prove whether it is already implemented, partially implemented or missing;
- identify conflicting concurrent edits;
- challenge unsafe schema, RLS, async, money, consent and old-binary assumptions;
- remove work that the current repository has already completed;
- flag any owner decision that changes legal, financial or UX behavior.

Do not begin a production mutation while another session is editing the same
migration/function/client contract.

## Implementation discipline

1. Work package-by-package and commit coherent slices.
2. Write failing tests or executable assertions before behavior changes.
3. For a replaced production function, fetch its deployed body and construct
   the new body from that exact definition.
4. Validate migrations on a fresh local Postgres fixture and in a transaction
   against production before applying.
5. New exposed tables require explicit grants plus RLS. Definer functions must
   revoke PUBLIC and self-authorize.
6. Use server authority for prices, entitlements, consent enforcement, refunds,
   settlement and segmentation.
7. Add all five locales in the same commit as customer-visible behavior.
8. Preserve old-binary compatibility or document the required minimum build.
9. Never call transport acceptance “device delivered”.
10. Keep cards dark until the payment package’s production gate passes.

## Verification report

End with:

- files and migrations changed;
- exact tests/queries/device checks run and results;
- deployment state and production version;
- old-binary compatibility;
- rollback path;
- remaining owner actions;
- what remains in the selected package.

Do not declare a package complete from typecheck alone. Use the acceptance
criteria in that package as the completion checklist.

## Recommended first assignment

First make one small corrective assignment from
`03-notifications-and-crm.md` Slice A: replace the live `IMMUTABLE`
`in_quiet_hours()` contract and remove or fully enforce the currently misleading
transactional switch. Then start `01-pilot-safety-release.md`.
