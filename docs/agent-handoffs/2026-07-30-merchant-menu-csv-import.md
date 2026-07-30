# Merchant menu CSV import handoff

Date: 2026-07-30
Agent branch: `codex/merchant-menu-scale`
Isolated worktree: `/Users/etch/Downloads/sharmeats-agent-merchant`
Branch base: `b144336`
Base main snapshot checked during review: `77f6bbc` (main was not edited)

## Outcome

Merchant owners/managers can download a CSV template, choose a completed file,
see exact row validation errors, review a preview, and import up to 500 menu
items. Staff-tier users never see the structural import control.

The bulk write is one manager-only Postgres RPC. Sections and items commit
together or all roll back. The importer is append-only:

- matching section names are reused case-insensitively;
- more than one case-insensitive existing section match is ambiguous and rejects
  the whole import;
- existing items are never updated;
- a matching item name inside the same section rejects the whole import;
- duplicate rows, malformed CSV, unknown flags, invalid prices/URLs/availability,
  excessive lengths, extra object fields, oversized JSON, and oversized batches
  are rejected before upload where possible and revalidated by the database;
- an RPC error is treated as an uncertain transport outcome rather than proof
  of rollback. The visible menu is refreshed, the preview is reconciled against
  the refreshed items, and the merchant is told to check before retrying.

## Files

- `apps/merchant-web/src/lib/menuCsv.ts`
  - dependency-free CSV parser, normalization, validation, and header-only
    download template;
  - handles BOM, CRLF, quoted commas/newlines, and escaped quotes;
  - exact columns:
    `section_name,item_name,description,price_egp,image_url,flags,is_available`.
- `apps/merchant-web/src/lib/menuCsv.test.ts`
  - parser, boundary, duplicate, malformed-file, existing-item, and template
    coverage.
- `apps/merchant-web/src/app/menu/MenuCsvImporter.tsx`
  - accessible choose/download controls, reading state, row errors, preview,
    server error/retry state, and atomic import action.
- `apps/merchant-web/src/app/menu/MenuCsvImporter.test.tsx`
  - preview-before-write, invalid-file no-write, one-RPC success, and retryable
    uncertain-outcome reconciliation coverage.
- `apps/merchant-web/src/app/menu/MenuManager.tsx`
  - mounts the importer only for manager+ users and refreshes the menu after
    success or uncertain RPC errors without clearing good state on a failed
    refresh;
  - creates sections/items through the transactional append RPCs, so the
    browser never sends a list-length-derived sort order.
- `apps/merchant-web/src/app/menu/MenuManager.test.tsx`
  - proves both create paths use the RPCs and never fall back to a direct
    table insert with a stale sort order.
- `supabase/migrations/20260730162500_atomic_merchant_menu_import.sql`
  - `import_merchant_menu(uuid,jsonb)` SECURITY DEFINER RPC;
  - manager-only `append_merchant_menu_section` and
    `append_merchant_menu_item` RPCs calculate `max(sort_order) + 1` while
    holding the same restaurant lock as the bulk importer;
  - one stable semantic `merchant-menu:<restaurant UUID>` advisory-lock
    namespace, independent of migration filenames;
  - BEFORE INSERT/UPDATE/DELETE guards on both menu tables make direct Data API
    writes and future clients acquire that lock too;
  - the guards prevent new case-insensitive section/item duplicates, reject
    cross-restaurant section/item combinations, and repair colliding sort
    orders from legacy direct inserts;
  - explicit authentication plus `is_merchant_manager()`/admin authorization;
  - pinned search path, PUBLIC/anon/authenticated execute revoked before the
    authenticated grant;
  - server-side 2 MB JSON limit, exact object keys, bounded flags and safe price
    casting;
  - ambiguous-section rejection, per-restaurant advisory lock, append-only
    duplicate protection, and one-transaction writes.
- `supabase/tests/20260730162500_merchant_menu_import.test.sql`
  - durable function/grant/trigger shape assertions;
  - manager success, staff denial, manager cross-tenant denial, admin
    cross-tenant success, server ordering, and whole-batch rollback coverage.
- `scripts/test-security-migrations.sh`
  - applies the timestamp migration and runs its durable regression after the
    migration-136 fixture/assertions.

No new dependency, table, storage bucket, edge function, or generated type was
added.

## Verification performed

- New tests were red first against the direct-insert client and missing lock
  helper, then green after implementation.
- Full merchant-web Vitest:
  `9 files / 75 tests passed`.
- `npm run typecheck`: passed.
- `npm run lint`: passed with zero warnings/errors (only Next's existing
  deprecation notice for `next lint`).
- Production `npm run build` with local placeholder public Supabase env:
  passed; `/menu` prerendered.
- The durable SQL regression ran in a disposable PostgreSQL 18 database after
  the repository's migration-136 production-shaped fixture and migration:
  - the helper is not client-callable and all public RPC grants are exact;
  - both tables have INSERT/UPDATE/DELETE mutation guards;
  - manager append uses server ordering;
  - staff and cross-tenant manager writes fail;
  - admin cross-tenant import succeeds;
  - a batch whose second row is invalid rolls back the first row's section and
    item.
- `scripts/test-security-migrations.sh`: passed end to end.
- `git diff --check`: passed.

Docker/Supabase local services were not running, so the migration was not run
through the full Supabase container stack and has not been applied to
production.

## Integration order

1. Cherry-pick the amended commit from `codex/merchant-menu-scale`.
2. Dry-run and review timestamp migration
   `20260730162500_atomic_merchant_menu_import.sql` against the full Supabase
   schema, then apply it before deploying merchant-web. Deploying the client
   first would expose controls whose RPCs are absent.
3. Run
   `supabase/tests/20260730162500_merchant_menu_import.test.sql` against the
   integration database.
4. After production apply, run the repository's `npm run db:types` and commit
   generated type changes if any.
5. Smoke test with an owner/manager account and a staff account.

## Conflicts and risks

- Likely merge conflict: `apps/merchant-web/src/app/menu/MenuManager.tsx` if
  concurrent work changes the menu header/loading region. Preserve the
  `editable && !loading` gate, `onImported={load}` behavior, and both append RPC
  calls.
- The timestamp filename avoids sequential migration-number collisions. The
  advisory key is semantic and must remain
  `merchant-menu:<restaurant UUID>` even if this migration is ever replaced.
- Normalized-name uniqueness is enforced by the serialized trigger rather than
  a unique index so legacy duplicates do not make this migration fail. Existing
  duplicate rows are left untouched; a new/renamed/moved conflicting row is
  rejected.
- CSV copy is currently English, matching the existing merchant-web surface.
- The import deliberately excludes modifiers. Those remain editable through
  existing product flows; expanding the CSV format should be a separate,
  explicitly versioned slice.

## Rollback

Revert the client commit, then remove the database surface in this order:

```sql
drop trigger if exists aaa_merchant_menu_mutation_guard
  on public.menu_items;
drop trigger if exists aaa_merchant_menu_mutation_guard
  on public.menu_sections;
drop function if exists public.merchant_menu_mutation_guard();
drop function if exists public.append_merchant_menu_item(
  uuid, uuid, text, text, integer, text, public.item_flag_type[], boolean
);
drop function if exists public.append_merchant_menu_section(uuid, text);
drop function if exists public.import_merchant_menu(uuid, jsonb);
drop function if exists private.acquire_merchant_menu_locks(uuid[]);
```

Already imported menu rows are ordinary merchant-owned rows and should not be
automatically deleted during rollback.
