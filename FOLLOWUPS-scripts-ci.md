# FOLLOWUPS — `scripts/` and `.github/workflows/`

Audit round 2, 2026-08-01. Scope: `scripts/` and `.github/workflows/` only.

---

## 1. What I fixed

### P1 — nothing checked that the 21 cron jobs were still running

| File | What |
|---|---|
| `scripts/check-cron-liveness.sh` (new, 245 lines) | Verifies every job the repository schedules has SUCCEEDED recently enough for its own cadence. Exit 0 clean / 1 dead / 2 misconfiguration, matching `check-db-drift.sh`. |

- The expected job list is **derived from the migrations**, not hardcoded: every
  `cron.schedule('name', …)` and `cron.unschedule('name')` under
  `supabase/migrations/` is extracted in apply order and last-operation-wins.
  Verified: it produces 19 jobs and correctly excludes `sharmeats-batch-shadow`
  (unscheduled by mig 196) including the copy of that call quoted inside a
  comment in the same file.
- Tolerance is derived per job from its own schedule
  (`period + max(period/2, 5 min)`), so a 20-second sweep is dead after ~5
  minutes and a daily job after 36 hours.
- Verdicts: `OK`, `DEAD`, `DISABLED` (active=false), `MISSING` (a migration
  schedules it, `cron.job` does not have it), `FAILING` (running, every recent
  run errored), `EXTRA` (in `cron.job`, no migration schedules it — reported,
  not failed), `UNVERIFIABLE` (see §3.1).
- **Tested** against a throwaway PostgreSQL with a fabricated `cron.job` /
  `cron.job_run_details`; all seven verdicts fire correctly.

`.github/workflows/production-drift.yml:164` — new `database` job runs both
`check-cron-liveness.sh` and `check-db-drift.sh` daily. The audit was right that
`check-db-drift.sh` was wired into nothing; it is now. The job skips **loudly**
(warning + step summary) when `secrets.PROD_DATABASE_URL` is absent rather than
reporting a green run that checked nothing.

### P1 — the production backup contained zero GRANT/REVOKE statements

| File:line | What |
|---|---|
| `scripts/backup-prod.sh:222` | Dropped `--no-privileges` from the schema dump. GRANT/REVOKE **and `ALTER DEFAULT PRIVILEGES`** are now captured — the latter matters directly for house rule 5b. |
| `scripts/backup-prod.sh:186` | `roles.sql` is now generated from `pg_roles` (names + memberships, no passwords/attributes) on the native path. Without it every GRANT in `schema.sql` fails "role does not exist". |
| `scripts/backup-prod.sh:264` | New guard: a schema dump with < 50 GRANT/REVOKE/ALTER DEFAULT PRIVILEGES statements is treated as a FAILED backup and not retained. Override `BACKUP_MIN_GRANTS`. |
| `scripts/backup-prod.sh:295` | `MANIFEST.txt` now records `grant_statements: <n>`. |
| `scripts/restore-backup.sh:261` | Loads `roles.sql` case-insensitively (native path writes lowercase), and warns explicitly when `schema.sql` has GRANTs but no roles exist. |
| `scripts/verify-restored-backup.sql:131` | New section **5b: GRANTS**. |

Section 5b asserts, and was **tested** against a scratch database in both states:

- `anon` / `authenticated` / `service_role` exist at all (otherwise no grant
  could have applied — reported as that, not as a dozen symptoms);
- ≥ 25 public tables carry a grant to one of those roles;
- ≥ 20 public functions have an explicit ACL (a NULL `proacl` on a SECURITY
  DEFINER RPC means PUBLIC still has EXECUTE — house rule 3);
- **migration 037's column lockdown specifically**: `authenticated` must NOT have
  UPDATE on `orders.status` / `payment_status` / `total_egp` /
  `assigned_driver_id`, must NOT be missing UPDATE on `rating_food`, and `anon`
  must hold no UPDATE on `orders` at all. With the hole open the verifier emits
  five named failures; with mig 037 applied it is silent.

### P2 — storage backup excluded delivery-proof and was never scheduled

| File:line | What |
|---|---|
| `scripts/backup-storage.sh:72` | Bucket list is now **discovered from the Storage API** instead of the hardcoded literal `kyc`. `delivery-proof` (mig 194) and `avatars` (mig 167) had never been backed up by anything; a bucket added by a future migration is now covered automatically. `BUCKETS=` still overrides for ad-hoc runs. |
| `scripts/backup-storage.sh:80` | `CRITICAL_BUCKETS="kyc delivery-proof"` is asserted present in whatever list is used, so a truncated/empty API response fails loudly instead of backing up nothing and exiting 0. |
| `scripts/backup-storage.sh:235` | Manifest records per-bucket object counts. |
| `scripts/com.sharmeats.storage-backup.plist` (new) | Daily 03:30 local launchd job — 30 minutes after the DB dump, so the `storage.objects` metadata rows and the object bytes come from the same night. Same `StartCalendarInterval`-only discipline as the DB plist, separate log file. |

### P2 — CI had no migration gate

| File:line | What |
|---|---|
| `scripts/check-migration-order.sh` (new) | Hard gate, no DB: duplicate numeric prefixes, duplicate name **stems** (`check-db-drift.sh` matches the ledger on stems, so a duplicate stem makes an unapplied migration look applied), and filename shape. Tested against a synthetic tree that trips all three. |
| `scripts/migration-prefix-allow.txt` (new) | Grandfathers the two existing duplicate prefixes (026, 197) so the gate can be hard **today**. Shrink-only; stale entries are reported. |
| `scripts/replay-migrations.sh` (new) | Applies every migration in order to a throwaway PostgreSQL (initdb + pg_ctl, same harness as `test-security-migrations.sh` — no Docker, no service container), over a documented Supabase shim. |
| `.github/workflows/ci.yml:144` | New hard-gate job `migration-order`. |
| `.github/workflows/ci.yml:180` | Advisory replay step inside `database-security-migrations`. |

`test-security-migrations.sh` was **already** wired into CI at
`ci.yml:160` before this change — that part of the audit finding was wrong. It is
untouched (another agent has it modified in this worktree).

**The replay found a real defect**: 205 of 206 migrations replay cleanly onto an
empty database. `187_e0_governance_repair.sql` fails —

```
ERROR: insert or update on table "platform_operator_capabilities" violates
       foreign key constraint "platform_operator_capabilities_granted_by_fkey"
DETAIL: Key (granted_by)=(91967dc5-9b0c-4ce4-ad8b-9810b3aee768)
        is not present in table "users".
```

It seeds a hardcoded production user UUID against an FK to `public.users`, so the
database cannot be rebuilt from the repository past that point. See §2.3.

### P2 — Sentry source maps

| File:line | What |
|---|---|
| `.github/workflows/eas-build.yml:157` | The preflight is now a real gate in the one case that matters and a warning in the others. |
| `.github/workflows/eas-update.yml:129` | New source-map upload for OTA updates. |

`eas-build.yml` preflight, restructured:

- upload **ON** + token **MISSING** → **hard failure in seconds**. That build
  cannot succeed (`SENTRY_ALLOW_FAILURE` is not honoured in
  `@sentry/react-native` 7.11.0, as the existing comment documents), so failing
  now saves ~20 minutes and one build credit. This IS the fail-safe: since the
  upload cannot be made non-fatal inside the build, the only way a Sentry problem
  never breaks a production build is to refuse to start a doomed one.
- upload **OFF** + token **PRESENT** → warning naming the exact one-line change.
- `eas env:list` that cannot RUN → warning, build continues. A flaky list call
  must not block a build.

`eas-update.yml` runs `npx expo export` + `npx sentry-expo-upload-sourcemaps dist`
before publishing, entirely `continue-on-error`. This matters more than the build
path: an OTA replaces the JS inside an installed binary, so the maps uploaded at
build time describe the *old* bundle. Debug IDs match because all three apps'
`metro.config.js` uses `getSentryExpoConfig`, whose serializer derives the Debug
ID from bundle content, and both exports run from the same checkout.

**THE SECRETS, EXACTLY — there are two, and they are different kinds:**

1. **`SENTRY_AUTH_TOKEN` as an EAS environment variable**, `production`
   environment, **per app** (sentry-cli runs on the EAS builder, not on a runner):
   ```
   cd apps/customer && npx eas-cli env:create --environment production \
     --name SENTRY_AUTH_TOKEN --value <token> --visibility secret
   # repeat for apps/driver and apps/restaurant
   ```
2. **`SENTRY_AUTH_TOKEN` as a GitHub Actions repository secret** (sentry-cli runs
   on the runner for the OTA path): Settings → Secrets and variables → Actions.

Mint the token at sentry.io → Settings → Auth Tokens with scopes
**`project:releases`** and **`org:read`**. Org/project are already in `eas.json`
(`SENTRY_ORG=beyond-mngmt`, `SENTRY_PROJECT=sharmeats-<app>`) and in each
`app.json`'s `@sentry/react-native` plugin block.

### Pre-existing bugs found while testing the verifier

`scripts/verify-restored-backup.sql` **could not complete a run against a broken
restore** — three latent defects, all fixed, all confirmed by running the file
against an empty database before and after:

1. `v_fail := v_fail || 'literal'` on 4 lines. `text[] || unknown` is parsed as an
   array literal, so it raised `malformed array literal` instead of recording the
   failure. The PostGIS check — the one the file's own header calls the most
   important — had therefore **never worked**. Now `::text`-cast.
2. §5's named-RLS loop used `('public.' || v_txt)::regclass` inside a subquery
   guarded by `to_regclass(...) is not null`. SQL does not short-circuit `AND`, so
   the cast raised `relation does not exist` and aborted the whole verifier.
   Now uses `to_regclass` inside the subquery.
3. §8's orders→restaurants FK check guarded only on `orders`, so it raised on
   `public.restaurants` and hid every check below it.

All three only fired on a *failed* restore — i.e. exactly the situation the file
exists to describe.

---

## 2. Deliberately NOT fixed

### 2.1 The two duplicate migration prefixes (026, 197) — needs a human decision

```
026_auto_accept.sql              197_dev_analysis_extensions.sql
026_referrals.sql                197_gen_random_bytes_search_path_fix.sql
```

Both pairs are **already applied to production**. Renumbering an applied migration
changes apply order — the exact change class this repo's house rules exist
because of — so I added detection and grandfathered these, per instructions.
Options for whoever decides:

- **(a) Leave them, keep the allow-list.** Zero risk. Cost: a fresh replay through
  the version-keyed ledger records prefix 026 once and 197 once, so one file of
  each pair is silently skipped on any rebuild. Acceptable only while a rebuild is
  hypothetical.
- **(b) Rename the *later-applied* file of each pair to the next free prefix
  (207, 208) and hand-stamp the ledger** so production keeps a row for the new
  name. Preserves replayability; requires a `supabase_migrations.schema_migrations`
  UPDATE against production, which nothing else in this repo does.
- **(c) Add a `026b`/`197b`-style suffix** so both files sort deterministically and
  produce distinct versions. `check-migration-order.sh`'s shape rule would need
  widening. Least ledger surgery, but invents a convention.

My recommendation is (b), during the same window as the mig-187 fix below, so the
replay gate can be promoted to a hard gate in one step.

### 2.2 `SENTRY_DISABLE_AUTO_UPLOAD` is still `"true"` in all three `eas.json`

`apps/*/eas.json` is outside my scope (`scripts/` + `.github/workflows/` only) and
another agent may hold those files. Once the EAS env var from §1 exists, the
remaining change is one line per app:

```
apps/customer/eas.json:29     "SENTRY_DISABLE_AUTO_UPLOAD": "true"  ->  "false"
apps/driver/eas.json:26       "SENTRY_DISABLE_AUTO_UPLOAD": "true"  ->  "false"
apps/restaurant/eas.json:26   "SENTRY_DISABLE_AUTO_UPLOAD": "true"  ->  "false"
```

The eas-build preflight now blocks a build that would fail for a missing token, so
this flip can no longer produce the 20-minute-late failure that caused commit
672881a to turn it back off.

### 2.3 Migration 187 cannot be replayed — needs a product/ops decision

`187_e0_governance_repair.sql` seeds `91967dc5-9b0c-4ce4-ad8b-9810b3aee768` (the
platform owner) into `private.platform_owner_events` and
`private.platform_operator_capabilities`, with `granted_by` FK'd to
`public.users`. Nothing creates that user, so it cannot apply to any database that
is not already production. The fix is a *new* migration, not an edit to 187
(house rule 2), and someone has to decide what a fresh environment's owner should
be. Options: guard the seed with `where exists (select 1 from public.users where
id = …)`; or read the owner id from `platform_settings`; or move the bootstrap out
of migrations entirely into a seed script. Not mine to choose.

Until then the replay job stays advisory. Promote it to a gate
(delete `continue-on-error` at `ci.yml:180`) the day it first passes.

### 2.4 `scripts/com.sharmeats.backup.plist` — path not touched

The DB backup plist in this worktree still points at
`/Users/etch/Downloads/sharmeats/scripts/backup-prod.sh` while the checkout is
`sharmeats-new`. I was told that fix landed in a separate change and not to redo
it, so I left it. **The new storage plist uses
`/Users/etch/Downloads/sharmeats-new/…`** — if the other change settled on a
different root, make the two agree before installing either. A stale absolute path
here is silent: launchd records the failure and simply never produces a backup,
which is how the DB job stayed dead from 2026-07-29.

Also: `scripts/check-backup-freshness.sh` does not exist in this worktree, so I
could not extend it. When it lands it should also assert a `storage-*` directory
from the last 26 hours, not just a DB dump.

### 2.5 Anything Paymob

Not touched, per instructions. Nothing in my scope required it.

---

## 3. Things the audit missed / precise specs for other agents

### 3.1 `sharmeats-purge-cron-history` retention is shorter than the weekly jobs

Mig 196 purges `cron.job_run_details` older than **2 days**. The weekly jobs —
`sharmeats-weekly-settlement` (`0 3 * * 1`),
`sharmeats-weekly-driver-settlement` (`5 3 * * 1`),
`sharmeats-marketplace-integrity` (`30 4 * * 1`) — therefore have **no run history
at all** for 5 of every 7 days. Nothing can prove they ran; `check-cron-liveness.sh`
reports them `UNVERIFIABLE` rather than inventing a failure.

**The SQL fix (another agent's scope):** change the purge command so it keeps the
most recent successful run per job regardless of age:

```sql
select cron.schedule(
  'sharmeats-purge-cron-history',
  '0 4 * * *',
  $$delete from cron.job_run_details d
     where d.start_time < now() - interval '2 days'
       and d.runid <> (select r.runid
                         from cron.job_run_details r
                        where r.jobid = d.jobid and r.status = 'succeeded'
                        order by r.start_time desc limit 1)$$
);
```

Cost is ~21 extra rows. `check-cron-liveness.sh` then verifies all 19 jobs with no
code change.

### 3.2 `push_receipt_sweep` — precise spec (SQL, not mine to write)

`174_push_receipt_sweep.sql:43` calls `net.http_post(url, body, headers)` with **no
`timeout_milliseconds`**, so it inherits pg_net's 5 s default. `199_site_health_watchdog.sql:119`
passes `timeout_milliseconds => 8000` for a plain HEAD-style probe; an edge
function that polls Expo's receipt API for a batch of tokens is strictly slower
than that, so 5 s is likely to time out under load. Worse, `push_receipt_sweep`
**returns the request id and nothing ever reads `net._http_response` for it**, so
a timeout, a 401 from a rotated internal secret, or a 500 from the edge function
are all indistinguishable from success — the function returns a bigint, cron
records `succeeded`, and no receipt is ever processed. `push_outbox_sweep`
(mig 203) has the same shape for its own POSTs; only `site_health_sweep` closes
the loop.

Needed, in one new migration:

1. Pass `timeout_milliseconds => 15000` (or higher) on the `net.http_post` in
   `push_receipt_sweep`, and on the per-message POST in `push_outbox_sweep`.
2. Adopt mig 199's **self-pipelining** pattern: persist the request id
   (`push_messages.dispatch_request_id` already exists for the outbox; the receipt
   sweep needs a single-row `platform_settings`-style slot or a small
   `push_receipt_runs` table), and at the START of the next run judge the previous
   id against `net._http_response`:
   - `status_code` between 200 and 299 → fine;
   - a row with any other status, or **no row at all** (pg_net expires responses)
     → treat as failed, and after N consecutive failures call
     `public.ops_alert(...)` exactly as `site_health_sweep` does.
3. Follow house rules: `set search_path`, `revoke all … from public, anon,
   authenticated`, `grant execute … to postgres`, and drop the old signature
   explicitly if the argument list changes.

Without (2), (1) alone just makes the invisible failure slower.

### 3.3 Seeded demo orders in production (data, not code)

I cannot touch production data. What needs cleaning, and how to find it:

```sql
-- The 11 rows driving cod_delivered_uncollected. Confirm they are demo rows
-- before deleting anything: real COD that was genuinely never collected must
-- NOT be swept up with them.
select o.id, o.created_at, o.status, o.payment_method, o.payment_status,
       o.total_egp, u.phone, r.name as merchant
  from public.orders o
  join public.users u on u.id = o.user_id
  left join public.restaurants r on r.id = o.restaurant_id
 where o.status = 'delivered'
   and o.payment_method = 'cash'
   and coalesce(o.payment_status, '') <> 'paid'
 order by o.created_at;
```

Distinguish demo from real by seeded phone numbers / the seed script's merchant
ids / `created_at` before the first real order. Delete in FK order —
`order_status_events`, `order_items`, `order_financials`, `driver_earnings`,
`driver_cash_ledger`, `credit_ledger`, then `orders` — inside one transaction,
after taking a backup. Deleting rather than back-dating: a demo order in the
financial tables corrupts every commission and settlement report, not just the
alert.

**The missing reconciliation class matters more than the cleanup.** Today nothing
detects a delivered order with **no `order_financials` row at all** —
3 of 12 real delivered orders silently lost their commission record and nothing
fired, because every existing check joins `order_financials` and so cannot see a
row that is absent. The `snapshot_order_financials` trigger is documented
fail-open (`062_money_foundation.sql:266`: "bookkeeping errors never block
delivery"), which is the right call for the customer and precisely why an
independent detector is mandatory. Add to `payment_reconciliation_sweep`
(mig 181):

```sql
-- class: delivered_without_financials
select o.id, o.delivered_at, o.total_egp
  from public.orders o
 where o.status = 'delivered'
   and o.delivered_at < now() - interval '15 minutes'   -- past the trigger window
   and not exists (select 1 from public.order_financials f where f.order_id = o.id)
```

Alert on count > 0 and expose the ids — this is unbilled commission, i.e. real
money the platform never invoiced. A companion repair RPC that calls
`snapshot_order_financials` for a named order id (admin-only, audited) would let
ops fix it without hand-writing money rows.

### 3.4 Smaller notes

- `scripts/check-db-drift.sh:127` builds a SQL array with unquoted `$rpc_names`
  word-splitting. Safe today (the extraction regex only matches
  `[a-zA-Z0-9_]+`), but it is one regex change away from an injection into a
  string it builds by hand.
- `.github/workflows/ci.yml:58` — the non-mobile install falls back from
  `npm ci` to `npm install` on lockfile drift. It logs a warning, but a
  lockfile-drifted surface can stay green indefinitely; nothing ever fails on it.
  Consider failing the fallback on `push: main` while keeping it on PRs.
- The replay shim needed `supabase_realtime` (publication), `vault.secrets` /
  `vault.decrypted_secrets` / `vault.create_secret`, and stubs for
  `cron.schedule`/`unschedule` and `net.http_post`. Nothing in the repository
  creates these; they are provisioned by the platform. Worth knowing if a second
  environment is ever stood up — that list is the exact bootstrap it needs.
