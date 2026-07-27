# Restore drill

**A backup you have never restored is a hope, not a plan.**

This project is on the Supabase **free** plan: no managed backups, no PITR
(verified 2026-07-25 via the Management API — `pitr_enabled=false`,
`backups=[]`). The logical dumps written by `scripts/backup-prod.sh` are the
*only* restorable copy of production. Until one has actually been restored,
they are an untested assumption.

This drill turns that assumption into evidence, repeatably.

---

## Prerequisites

| | |
|---|---|
| PostgreSQL client + server | `psql`, `createdb`, `dropdb` on `PATH` (drilled on Homebrew PostgreSQL 18.4) |
| **PostGIS** | `brew install postgis` — **required**, see below (drilled on 3.6.4) |
| A complete backup | any non-`-FAILED` directory in `~/sharmeats-backups` |

Verify PostGIS is visible to the *server*, not just installed:

```bash
psql -d postgres -tAc "select default_version from pg_available_extensions where name='postgis';"
```

### PostGIS is not optional

`public.addresses`, `drivers`, `hotels`, `kitchens` and `restaurants` all have
`geography` columns — 23 references in the 2026-07-27 dump. Without the
extension those five `CREATE TABLE`s fail and roughly **180 dependent
statements cascade**. The output looks like a corrupt backup and is not.

This is a real trap: the first drill attempt on 2026-07-27 produced exactly that
and was briefly misread as a backup problem. `restore-backup.sh` now checks for
PostGIS **before creating anything** and says so plainly.

---

## Running a drill

```bash
scripts/restore-backup.sh ~/sharmeats-backups/20260727T022014Z
```

That is the whole thing. It picks a safe scratch name
(`sharmeats_drill_<utc-stamp>`), restores into it, verifies, and writes a
timestamped report to `~/sharmeats-drills/`.

Options:

```bash
# choose the scratch database name
scripts/restore-backup.sh <backup-dir> drill_2026_07_27

# replace an existing scratch database
scripts/restore-backup.sh <backup-dir> drill_2026_07_27 --force-drop

# put reports somewhere else
DRILL_REPORT_DIR=/Volumes/ext/drills scripts/restore-backup.sh <backup-dir>
```

The scratch database is **kept** after a successful drill so you can look
around. Drop it when finished: `dropdb sharmeats_drill_<stamp>`.

---

## What the script refuses to do

All of these fail **before** anything is created or modified:

| Refusal | Why |
|---|---|
| A database name containing `prod`/`production`/`live`/`main`, or `postgres` | A drill must never point at something real |
| A name containing the production project ref | Same |
| `PGHOST` on `*.supabase.co` or a pooler host | This drill is local-only. `RESTORE_ALLOW_REMOTE=1` overrides — never use it against production |
| A name that is `/`, `$HOME`, the repo root, or contains `/` | Someone passed a directory where a database name goes |
| A backup directory ending `-FAILED` | `backup-prod.sh` marks incomplete runs that way |
| Missing `MANIFEST.txt` / `schema.sql` / `data.sql` | Not a complete backup |
| `schema.sql` or `data.sql` under 1 KiB | Truncated or partially copied |
| `schema.sql` with no `CREATE TABLE`, or `data.sql` with no `COPY`/`INSERT` | Wrong file, or an error page saved by mistake |
| A `MANIFEST.txt` with no `taken_at_utc` | Not written by `backup-prod.sh` |
| An existing database, without `--force-drop` | Never clobber silently |
| PostGIS unavailable | See above |

---

## What the verifier checks

`scripts/verify-restored-backup.sql` is read-only and fails loudly on the first
problem. "The restore exited 0" is not the same as "the restore worked" —
`psql` will happily finish a file whose middle third failed.

1. **Schemas** — `public`, `auth`, `storage` all present.
2. **PostGIS** — installed in the restored database.
3. **The five geography-bearing tables** — named individually, so their absence
   is reported in business terms rather than as a type error.
4. **Core money/lifecycle tables** — `orders`, `order_items`,
   `order_financials`, `order_status_events`, `users`, `merchant_staff`,
   `menu_items`, `restaurant_settlements`, `driver_cash_ledger`,
   `customer_credits`, `kyc_documents`, `platform_settings` and others.
5. **RLS** — at least 60 public tables have row-level security (prod had 71 on
   2026-07-27), and it is specifically enabled on `orders`, `order_financials`,
   `kyc_documents` and `users`. A restore that dropped RLS reads fine and leaks
   everything.
6. **Authority functions exist with exactly ONE overload** — `place_order`,
   `advance_order_status`, `snapshot_order_financials`, `is_merchant_staff`,
   `is_merchant_manager`, `auth_role`. Two overloads means PostgREST answers
   PGRST202 on every call (migration house rule 1; this has already caused a
   production outage here).
7. **Authority triggers** — `trg_menu_items_privileged_columns` and
   `trg_restaurants_privileged_columns` from migration 136. Losing them silently
   reopens the staff-tier price and payout hole.
8. **Referential integrity across the auth boundary** — no `public.users` row
   without a matching `auth.users` row, no order pointing at a missing
   restaurant.
9. **`platform_settings` is not empty** — the table shape without its rows gives
   you a database that starts and then quietly stops dispatching.

It also prints row counts for `orders`, `users`, `restaurants`, `menu_items` and
`order_financials` so an operator can eyeball them against the manifest.

---

## Reading the report

Reports land in `~/sharmeats-drills/drill-<stamp>.txt`, deliberately **outside**
the backup directory so a drill can never modify or be confused with the
artifact it is testing.

```
RESULT: PASSED
```
means every check above held.

```
schema_errors: 0
data_errors:   0
```
Non-zero counts are worth reading even when the verifier passes. Expected and
harmless: `spatial_ref_sys` data is absent from the dump because it is
PostGIS-extension-owned and `CREATE EXTENSION postgis` regenerates it.

`roles: NOT PRESENT` is expected on the native `pg_dump` path — Supabase's
pooler does not grant the superuser access needed to dump cluster roles. Roles
are all declared in `supabase/migrations/`, so recreate them from there before a
real restore. This is a documented limitation, not a drill failure.

---

## Cadence

**Quarterly**, and additionally after any change to `backup-prod.sh`, the
schema's extension requirements, or the Supabase plan.

Record each drill below. A drill that was not recorded did not happen.

| Date | Backup used | Operator | Result | Report |
|---|---|---|---|---|
| 2026-07-27 | `20260727T030334Z` | etch@ETCHs-MacBook-Pro-2 | **PASSED** | `~/sharmeats-drills/drill-20260727T194820Z.txt` |

### What the first drill found

It failed on the first run, and that is the point: **all three failures were
bugs in the checking, not in the backup.** The dump restored byte-perfectly the
whole time. Fixed in the same commit:

1. **`customer_credits` does not exist and never has.** The verifier's core-table
   list was written from a guessed name; the customer wallet is `credit_ledger`
   (plus the `customer_credit_balance` view). A wrong name in a verifier is worse
   than no check — it fails every drill forever and teaches the operator to
   distrust good backups. Every name on that list has now been checked against
   production.
2. **The RLS floor compared incompatible quantities.** It expected `~71` from
   counting `ENABLE ROW LEVEL SECURITY` lines in the dump (72), against a query
   counting `relkind='r'` only. Production actually has 50 base tables, 48 with
   RLS — so the observed 48 was the *correct* answer. Floor is now 45.
3. **The table count summed every schema.** `grep -c "^CREATE TABLE"` returned 80
   (49 public + 23 auth + 8 storage) and was compared against a public-only
   count, so a perfect restore reported "50 restored, expected 80" and looked
   like 30 tables had vanished. Now counts `public` only, and both sides exclude
   `spatial_ref_sys` (PostGIS creates it; the dump never does).

A fourth fix was diagnostic rather than correctness: the script recorded
`schema_errors: 1` and **discarded the error text**, so diagnosing it meant
re-running the load by hand. Full `psql` logs are now written beside the report
and the first few errors are inlined into it.

The one remaining schema error is expected and benign: `schema "public" already
exists`, because `pg_dump` emits `CREATE SCHEMA public` and `createdb` has
already made it.

Verified restored: 43 restaurants, 1,038 menu items, 109 users, 23 orders,
9 order_financials rows. All 14 safety refusals re-tested after the edits; none
created a database.

---

## Storage is a separate drill

`pg_dump` captures the `storage.objects` metadata rows but **not the file
bytes**, which live in S3 behind the Storage API. Restoring `data.sql` alone
recreates rows pointing at objects that no longer exist — a dangling pointer
that looks like a successful restore.

Use `scripts/backup-storage.sh` for the `kyc` bucket. As of 2026-07-27 it holds
**zero objects**, so there is nothing to sample-restore yet. Once merchants
begin uploading, add a sample-restore step here: download one object from the
backup and compare its checksum against the live object.

KYC documents are the only asset in this system that cannot be reconstructed
from anything else. Orders and settlements can be recomputed; a passport scan
has to be collected again from a human.

---

## Known gaps

- **Off-machine retention is unproven.** Every backup currently lives in
  `~/sharmeats-backups` on the same laptop that holds the Keychain password and
  the launchd scheduler. Copy one encrypted backup to an independent location
  and record where, who holds the key, the retention period and who can reach it
  in a recovery.
- **Roles are not captured** on the native dump path (above).
- ~~**No drill has passed yet.**~~ **Closed 2026-07-27** — see the drill log
  above. The backups are now tested, not merely complete.
- **The passing drill used a laptop-local backup.** Recovery is proven; recovery
  *from an independent copy* is not, and that is the gap above.
