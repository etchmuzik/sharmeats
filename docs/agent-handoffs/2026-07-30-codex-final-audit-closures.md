# Codex handoff — final integration audit closures

Date: 2026-07-30

Branch: `codex/restaurant-readiness-stack`

Base audited: `848ff79`

## Outcome

The final read-only integration audit found two P2 contract gaps. Both are now
closed in the isolated integration branch; Claude's `main` worktree and every
production system remain untouched.

## Generated database contract

`packages/db-types/database.types.ts` now exposes:

- `append_merchant_menu_section(uuid,text) -> uuid`;
- `append_merchant_menu_item(uuid,uuid,text,text,int,text,item_flag_type[],bool)
  -> uuid`;
- `import_merchant_menu(uuid,jsonb) -> jsonb`.

The TypeScript representation uses string UUIDs, the generated
`item_flag_type` enum array, and `Json` for the bulk payload/result. Existing
Package 08 delivery tables/functions and Package 07 `food_cuisine_type`
additions are preserved.

`apps/merchant-web/src/lib/databaseTypes.test.ts` is a compile-time contract
test for the exact argument names and return types. A future regenerated type
file that omits or reshapes an RPC fails merchant typecheck.

## Package 07 CI execution

`supabase/tests/20260730162600_p07_governance_fixture.sql` is a committed,
production-contract fixture for the relevant schema surface:

- client roles and `auth.uid()`;
- user/restaurant/cart/order/vertical columns used by the migration;
- lifecycle suppression constraint and the real user FK;
- private-access visibility behavior;
- the production users-row → exclusive vertical advisory-lock order.

`scripts/test-security-migrations.sh` creates a separate database inside its
own temporary local PostgreSQL cluster, loads that fixture, applies
`20260730162600_p07_governance_hardening.sql`, then executes both the functional
hardening and two-session `dblink` concurrency suites.

There is no supplied database URL, linked project, secret, network connection,
or conditional skip. The script cannot target production, and any missing
PostgreSQL capability or failing assertion fails CI. The workflow step is named
accordingly.

## Verification

- Merchant TypeScript: passed.
- Merchant full Vitest: 10 files / 76 tests passed.
- Focused generated-contract + CSV tests: 2 files / 9 tests passed.
- `bash -n scripts/test-security-migrations.sh`: passed.
- Full security migration harness: passed.
- Package 07 hardening shape and functional ledger assertions: passed.
- Package 07 two-session concurrency assertions: passed for both producers and
  the real private-access lock order.
- `git diff --check`: passed.

No migration filename/order changed, and no database, deployment, Edge Function
or production data was mutated.
