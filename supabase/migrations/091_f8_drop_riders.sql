-- 091_f8_drop_riders.sql
-- F8 (2026-07-05 audit): drop the dead legacy `riders` table.
-- Evidence it is dead (verified live 2026-07-05):
--   * 0 rows in public.riders
--   * 0 non-null drivers.legacy_rider_id values (the only FK into it)
--   * no function references it (pg_proc prosrc scan = none; rider_snapshot
--     reads drivers, not riders), no views depend on it, no app/edge code
--     references it (repo grep = only generated db-types)
--   * RLS-enabled-with-no-policy — permanently inaccessible to clients anyway.
--
-- Idempotent via IF EXISTS. Rollback: restore the table + column from the
-- original schema migration (riders DDL) — but there is no data to restore.
-- Follow-up after prod apply: `npm run db:types` so packages/db-types drops the
-- riders/legacy_rider_id types.

alter table public.drivers drop column if exists legacy_rider_id;
drop table if exists public.riders;
