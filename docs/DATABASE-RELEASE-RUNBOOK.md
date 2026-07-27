# Production database release runbook

## Current release status

Database deployment is intentionally blocked.

On 2026-07-24, `scripts/check-linked-migration-history.mjs` found:

- 122 repository migrations absent from the linked migration ledger;
- 81 linked migrations absent from the repository ledger;
- no aligned migration entries.

Running `supabase db push` in this state could replay years of local SQL against
the live database. Do not use `db push`, `db reset`, or bulk `migration repair`
until the history is reconciled and rehearsed on a disposable staging restore.

The additive payment and KYC changes are ready in source and are exercised by:

```sh
./scripts/test-security-migrations.sh
```

**Exception — `122_referral_reward_crypto_fix.sql` is a standalone runtime
hotfix** with zero coupling to unshipped binaries: it repairs the four broken
SECURITY DEFINER functions (redeem_credit, redeem_points, review_kyc_document —
carried forward verbatim from 120 — plus reward_referrer_on_delivery, whose
swallowed gen_random_bytes failure had silently stopped referral-reward minting
since 2026-07-03). It may be applied to production ahead of the reconciliation
below; re-applying 120 later over it is a no-op. After applying, count referrals
stranded in `pending` with a delivered order (see the comment in 122) and decide
an owner-approved backfill.

**APPLIED — migration 144 went to production on 2026-07-27.** Adds
`admin_test_ops_alert()` (Package 01 §5): an admin-only, argument-less,
rate-limited RPC that fires one `[TEST]`-prefixed ops alert, so the Telegram
path can be proven without waiting for a real incident. `ops_alert` itself is
unchanged and still has no `authenticated` grant — this is a narrow doorway
beside it, not a widening of it.

Applied by direct `psql --single-transaction` over the pooler, **not**
`db push` (see the ledger divergence above). Validated first with a
`BEGIN … ROLLBACK` dry run against the real production schema running
`supabase/tests/144_admin_test_ops_alert.test.sql`; all six assertions passed
and rollback left zero residue (verified: 0 matching functions afterwards).

Post-apply verification: exactly 1 overload, `SECURITY DEFINER`,
`search_path=public, pg_temp`, `anon`/`PUBLIC` EXECUTE **false**,
`authenticated` **true**, and an unauthenticated call raises `AUTH_REQUIRED`
(SQLSTATE 23514). Types regenerated (one added line). Advisors went 157 → 158;
the single new finding is the expected
`authenticated_security_definer_function_executable` for this function, which
is the intended design — the in-body admin check is the gate, matching the 74
existing functions with the same shape.

Rollback: `drop function public.admin_test_ops_alert();` — nothing depends on
it and it writes no business state.

**APPLIED — migration 142 went to production on 2026-07-27.** Pins
`search_path` on `in_quiet_hours` (flagged `function_search_path_mutable` by
the advisor) and corrects it from IMMUTABLE to STABLE — it reads `now()`, so
IMMUTABLE would have licensed the planner to cache a stale hour, i.e. a
marketing push at 3am. It is called from `marketing_allowed()`, which is
SECURITY DEFINER, so an unpinned search_path there is a real class of hazard
even though no exploitable path existed (the body calls only built-ins).

**APPLIED — migration 141 went to production on 2026-07-27. CRITICAL.**
The public **anon key could TRUNCATE most of the database.** TRUNCATE ignores
row-level security, so the control this entire schema depends on gave no
protection, and the anon key ships inside every app binary. Verified against
production as the `anon` role in a rolled-back transaction — all of these
succeeded: `platform_settings` (60→0: COD caps, fee rules, ops webhook),
`order_status_events` (90→0), `push_tokens` (40→0), `loyalty_points_ledger`
(30→0), `order_financials` (9→0 — every commission record), `driver_earnings`
(9→0), `credit_ledger` (8→0 — customer wallets), `kyc_documents`.

`orders`, `users` and `addresses` resisted only because Postgres refuses to
truncate a table referenced by a foreign key — incidental, not a control
(`TRUNCATE … CASCADE` is the documented way around it, and leaf tables have no
such luck). Root cause is the same `ALTER DEFAULT PRIVILEGES` behind house
rule 5b. Fixed by revoking TRUNCATE/TRIGGER/REFERENCES from `anon` and
`authenticated` on every `public` table and from the `postgres` default
privileges. SELECT/INSERT/UPDATE/DELETE untouched — those are what RLS governs.
Post-apply: 12 probed tables all `BLOCKED 42501` with row counts intact, 5/5
apps typecheck, 195 tests green, harness 100% pass.

Two limits, both documented in the migration: the `supabase_admin`
default-ACL entry cannot be altered (`postgres` is not a superuser here and is
not a member of that role), and `spatial_ref_sys` is not ownable. **So house
rule 5b still applies to every new table** — the default alone is not enough.

Related check performed at the same time: client-writable "authority" columns
(`kyc_documents.status`, `order_refunds.status`, `zones.is_active`, …) were
probed as a real customer and all affected **0 rows** — RLS blocks them, so
those grants are inert. That is the distinction that made TRUNCATE dangerous
and these harmless: TRUNCATE bypasses RLS, UPDATE does not.

**APPLIED — migrations 139 + 140 went to production on 2026-07-27.** Saved
dishes. `favorite_items` (owner-RLS, composite FK to `menu_items(id,
restaurant_id)` so the denormalised restaurant id cannot drift, cascading on
both user and item delete so account deletion needs no new code) plus
`my_favorite_items()` and a Saved screen.

⚠️ **Two security findings surfaced while building it, both fixed here.**

1. **Every new `public` table is created with full client privileges.**
   `pg_default_acl` shows `ALTER DEFAULT PRIVILEGES` granting `arwdDxtm` to
   `anon` and `authenticated` on every new table, from both the `postgres` and
   `supabase_admin` grantors. *Not granting* a privilege is therefore a no-op —
   it must be explicitly REVOKED. This is house rule 3's function trap applied
   to tables, and it is now a house rule in its own right: **every
   `create table` in `public` must be followed by `revoke all ... from public,
   anon, authenticated` before its real grants.**
2. **TRUNCATE bypasses RLS**, so "RLS enabled, no policies" does NOT protect a
   table from being emptied. Two existing tables were reachable this way and
   were verified exploitable with the anon role against production (rolled
   back): `order_financials_failures` (mig 135 — the unbilled-revenue repair
   queue, i.e. the evidence that an order was delivered but never billed) and
   `push_campaigns` (mig 078). Both are now revoked from all client roles; the
   admin campaign history still works because `recent_push_campaigns` is
   SECURITY DEFINER (asserted, not assumed).

**140 fixes a defect in 139 caught by end-to-end testing.** `my_favorite_items`
was SECURITY INVOKER, but it joins `menu_items` and `restaurants`, whose RLS
(`menu_items_read`: `is_available = true OR …`) hides unavailable items from
customers. So a saved dish VANISHED from the Saved screen the moment it sold
out — the exact behaviour 139's header promised would never happen. It is now
SECURITY DEFINER with the scope pinned to `auth.uid()` inside the body and no
arguments, so it cannot return another user's saves (asserted). Verified in
production: sold-out saved dish returns 1 row where it returned 0 before.

**APPLIED — migration 138 went to production on 2026-07-27.** Notification
consent. The customer settings screen showed two toggles that were static
`<View>`s — no handler, no persistence, and no table to persist into — while
`send_push_campaign` pushed to every customer with a token. The UI rendered
"Promotions" in the OFF style, so it read as a working opt-out that did
nothing. `notification_prefs` (owner-RLS, written only through
`set_notification_prefs()`) now holds transactional/marketing switches, quiet
hours, and consent provenance. **Marketing is opt-IN**: the 40 pre-existing
token holders never consented, and defaulting them ON would manufacture
consent. Enforcement is server-side — every segment in `send_push_campaign`
is filtered through `marketing_allowed()`, and `push_campaigns.suppressed_count`
records how many the gate removed so a shrinking audience reads as consent
working rather than a broken segment. Quiet hours suppress marketing only; a
transactional push is never delayed.

Verified end-to-end against production (rolled back): with one customer opted
in and one explicitly opted out, a real `send_push_campaign('all')` targeted
**1 recipient and suppressed 38** — reconciling exactly against the 39
customer token-holders (the 40th token belongs to a non-customer role).

⚠️ **Process lesson — assertions that write are not free.** The apply run's
assert block called the real `set_notification_prefs(p_marketing := true)`,
and because the apply commits (unlike the dry run), it left a genuine consent
row in production for a real user who never opted in. It was caught by an
end-to-end count that did not match, then deleted (`prefs_rows_left = 0`
confirmed). **Assertions that mutate consent, money, or any audited state must
run in the dry-run transaction ONLY, never in the committed apply** — assert
structure and ACLs at apply time, behaviour at dry-run time.

**APPLIED — migration 137 + expo-push v14 went to production on 2026-07-27.**
Marketing campaigns had never delivered a single push: `send_push_campaign`
sent `orderId: ''` and the edge function rejected every such request with 400,
while the campaign row — inserted *before* the fire-and-forget `net.http_post`
— displayed as "sent". The same required-`orderId` check made two other
senders smuggle non-order ids into the field, so `credit_issued` (no order)
deep-linked to `/order/<userId>` and `referral_rewarded` to the referred
friend's order. Fix: `orderId` is now optional and an explicit `route` carries
the destination (`/rewards` for both), with orderId-based routing retained as
the fallback so **already-installed binaries and old senders are unaffected**.
`push_campaigns` gained `delivery_status`/`delivery_detail`/`net_request_id`,
settled from `net._http_response` by `reconcile_push_campaigns()` on a
5-minute cron — a campaign can no longer read as successful when it failed,
and unconfirmable sends (pg_net prunes responses after ~6h) settle to `failed`
rather than sitting on "dispatched" forever. The one historical campaign was
reclassified to `failed` with an explanatory detail.

Verified against production, not inferred: the exact payload that returned
`400 event + orderId required` now returns **`200 ok (no tokens)`**
(`net._http_response` id 9154), and a dispatched campaign bound to that
request settled to `delivered` when the reconciler ran. Deploy order matters
— the migration is inert until the function is deployed; deploy the function
first or in the same window. **Ordering note:** this was authored as `136`
and renumbered to `137` because the parallel session had already taken `136`.

**APPLIED — migration 136 went to production on 2026-07-27.** The existing
single `merchant_staff` row remained `owner`; no production roles required
normalization or backfill. The role is now load-bearing: `owner` and `manager`
can change prices, menu structure and storefront state, while `staff` can only
change `menu_items.is_available` and `sort_order`. A column allow-list protects
SKU, barcode, unit, prescription gating, timestamps and future columns from
staff writes; restaurant payout and `is_open` changes fail loudly rather than
optimistically appearing to succeed. Pre-apply checks found no invalid roles or
restaurants lacking a manager-tier member. Verified by a live BEGIN/ROLLBACK,
then committed with post-apply function/trigger checks; the 40-case Postgres
privilege matrix is included in `scripts/test-security-migrations.sh`.
Pre-apply backup: `~/sharmeats-backups/20260727T015446Z`.

**APPLIED — migration 135 went to production on 2026-07-27** (numbering gap:
134 intentionally skipped, like the 064 precedent). Validated with a
BEGIN…ROLLBACK dry run on the live schema whose functional assert proved the
placement stamp (a test order picked up the live 12.00 rate, then rolled
back), then applied with COMMIT via psql over the pooler; the pre-apply
`snapshot_order_financials` body was preserved in `__pre_mig126_129_snapshot`
(now 13 rows). Fixes three billing defects in the delivered-transition
trigger: commission is now frozen at placement
(`orders.commission_pct_snapshot`; pre-135/in-flight orders fall back to the
live rate — old behaviour, no restatement), a NULL rate now falls back to the
standard 15% (was the founding 12%), and the blanket exception swallow is
replaced by per-path handlers, the `order_financials_failures` repair queue,
and `ops_alert`. Any unresolved row in `order_financials_failures` is
unbilled revenue — check it in the weekly digest. Advisors post-apply: no new
findings (`order_financials_failures` INFO rls_enabled_no_policy is by
design — deny-all, definer-written).

**APPLIED — migrations 130–133 went to production on 2026-07-27** (same
md5-guarded protocol as 126–129 below; dry-run asserts exercised the real
`admin_issue_credit`, the whitespace-reference guard, the price bounds and the
watchdog on the live schema before commit; pre-apply bodies of the two
replaced functions added to `__pre_mig126_129_snapshot`, now 12 rows).

**APPLIED — migrations 126–129 went to production on 2026-07-27** via the
same standalone route as 122 (each additive, idempotent, no binary coupling),
executed over the Supabase MCP with an md5-guarded protocol: each migration's
bytes were dollar-quoted into a DO block that verified `md5(src)` against the
repo file's hash server-side BEFORE `EXECUTE`, dry-run first
(BEGIN…ROLLBACK with asserts calling the real functions), then applied
(…COMMIT). The dry run caught one real ordering bug pre-apply (the kitchens
RLS policy referenced `restaurants.kitchen_id` before the column existed —
invisible to the shim suite). Post-apply: 15 functions with zero duplicate
overloads, all 11 crons active, zone guard live (Cairo pin → no zone),
ranking_integrity_audit clean, security advisors show no new findings (one
missed trigger-function EXECUTE revoke was caught by the advisor and fixed
in-place + in the file).

**Rollback artifact:** `public.__pre_mig126_129_snapshot` (12 rows) holds the
exact pre-apply `pg_get_functiondef` + ACL of every replaced function —
created in the same transaction as the apply, because the off-site backup
script was blocked at the time. Drop the table after the ledger
reconciliation.

**RESOLVED 2026-07-27 — first verified off-site backup taken**
(`~/sharmeats-backups/20260727T010726Z`, git 32b54f3): all 79 tables across
public/auth/storage matched live prod row-for-row (6,855 rows, incl.
`kitchens`; the only delta is `spatial_ref_sys`, extension-owned and
intentionally excluded by pg_dump). Schema dump carries 81 policies, 126
functions, 31 triggers. The Keychain item `sharmeats-db-password` is live and
the launchd daily run can now succeed. Restore note: the data step needs
`psql -c 'set session_replication_role = replica' -f data.sql` — circular FKs
(users↔addresses, users↔payment_methods) fail a naive load. Connection facts
that cost five failed attempts: the project region is **eu-west-1** (the
Management API is authoritative; README used to claim eu-central-1) and the
pooler port is **6543** — see the comments in `scripts/backup-prod.sh`.
Still on the owner: copy the backup off this machine, and export the `kyc`
Storage bucket separately once documents exist (currently zero objects).

Re-verification at any time: paste `supabase/tests/126_129_dryrun_prod.sql`
into the Dashboard SQL editor and Run — it BEGINs, re-applies (no-op),
asserts, ROLLBACKs; success = the `DRY RUN COMPLETE` row.

Seeding the kitchen (owner, when brand data is real):
`admin_upsert_kitchen(...)` then
`admin_set_merchant_type(id, 'own_brand', kitchen_id)` per brand. Zone id for
Mercato: confirm against `select id from zones` (likely `hadaba`;
`naama_bay` does not exist).

The shim harness (`scripts/test-security-migrations.sh`) validates the logic in
CI; step 2 validates the actual SQL against the actual schema. Keep both — the
shim suite alone demonstrably missed a real crash (2026-07-27 review).

## Old-binary compatibility windows (accepted, close as binaries roll out)

Applying 120 + `20260724120946` before the SDK-57 binaries reach devices opens
three bounded windows for OLD field binaries: (1) KYC re-submission via
`upsert: true` fails once `kyc_update_own` is dropped (fresh first uploads still
work if they match the typed-path regex; legacy-format paths are rejected by the
new insert policy); (2) KYC uploads over 5 MiB or non-JPEG/PNG/WebP are rejected
by the new bucket constraints; (3) on shared devices, the old direct push-token
upsert can hit the new unique(token) index and fail silently. All are
onboarding/edge flows, acceptable during the release window — do not widen
policies to avoid them.

## Backups (there are none from Supabase — read this)

Verified against the Management API on 2026-07-25: the project is on the
**Free plan**, so it has **no managed backups at all** — `pitr_enabled: false`
and zero daily snapshots. `walg_enabled: true` is internal infrastructure and is
**not** an operator-restorable backup. Nothing automatic protects this database.

Until the plan is upgraded, off-site logical dumps are the only protection:

**One-time setup** (store the password in the Keychain so backups can run
unattended — it never touches a plaintext file, the plist, or `ps` output):

```sh
security add-generic-password -a "$USER" -s 'sharmeats-db-password' -w 'YOUR-DB-PASSWORD'
./scripts/backup-prod.sh                     # verify it works → ~/sharmeats-backups/<UTC stamp>/
```

**Schedule it daily** (03:00; catches up after sleep rather than skipping):

```sh
cp scripts/com.sharmeats.backup.plist ~/Library/LaunchAgents/
launchctl load ~/Library/LaunchAgents/com.sharmeats.backup.plist
launchctl start com.sharmeats.backup     # run once now, don't wait for 03:00
tail -20 ~/sharmeats-backups/backup.log  # confirm it succeeded
```

An ad-hoc run without the Keychain item still works via
`export SUPABASE_DB_PASSWORD='...'`.

The script dumps roles + schema + data, writes a MANIFEST, refuses to silently
produce a truncated dump, keeps the newest 14 runs, and writes 0600 into a 0700
directory. Output is gitignored — the dumps contain every customer row.

Two things the script cannot do for you:

- **Copy the backup off this machine.** A backup stored only on the laptop that
  could die with it is not a backup.
- **Back up Storage.** The `kyc` bucket holds merchant/driver identity documents
  and a database dump does not contain the files. Export it separately.

**A backup you have never restored is an assumption, not a backup.** Rehearse a
restore into a scratch database (`roles.sql` → `schema.sql` → `data.sql`) at
least once, and confirm row counts against the manifest.

> **First drill PASSED 2026-07-27** — backup `20260727T030334Z` restored into a
> local scratch database and verified: 43 restaurants, 1,038 menu items, 109
> users, 23 orders. Report: `~/sharmeats-drills/drill-20260727T194820Z.txt`.
> Procedure, cadence and what the first drill exposed (three bugs in the
> *verifier*, none in the backup) are in [`RESTORE-DRILL.md`](RESTORE-DRILL.md).
>
> Still open: the drill used a laptop-local backup, so recovery from an
> independent off-machine copy remains unproven.

Upgrading to Pro is what actually fixes this: it turns on daily backups and
makes PITR available, and it is the prerequisite for the "enable a recoverable
backup/PITR plan" gate below.

## Mandatory gates

1. Freeze production DDL and keep `CARD_PAYMENTS_ENABLED=false`.
2. Enable a recoverable database backup/PITR plan and test a restore. A schema
   dump alone is not a customer-data backup. **Status: NOT satisfied — free plan,
   no managed backups. `scripts/backup-prod.sh` is the interim mitigation.**
3. Save a schema-only production snapshot outside the public repository:

   ```sh
   umask 077
   supabase db dump --linked --schema public,storage \
     --file /secure/location/sharmeats-production-schema.sql
   ```

4. Capture the mismatch report:

   ```sh
   supabase migration list --linked --output-format json \
     > /secure/location/sharmeats-production-migrations.json
   ./scripts/check-linked-migration-history.mjs
   ```

5. Restore production into an isolated staging project. Map every remote ledger
   version to the exact SQL that produced the current schema. Do not mark a
   migration applied merely because its filename looks similar.
6. Rehearse the reconciled history and both new security migrations on the
   staging restore. Run app tests, Edge Function tests, and the Maestro smoke
   suite against staging.
7. Schedule a maintenance window. Re-run the read-only preflight queries below,
   review locks/table size, take a fresh backup, and apply only the reviewed SQL.
8. Deploy in this order:

   - database security migrations (120, 121, `20260724120946`; the 122 hotfix
     may already be live — re-applying 120 over it is a no-op);
   - Paymob Edge Functions with secrets configured;
   - native driver/restaurant/customer store builds;
   - compatible OTA JavaScript only after the matching runtime is installed.

9. Keep card payments disabled until a sandbox order proves intention creation,
   signed webhook settlement, replay handling, and full-refund reconciliation.
10. Monitor database errors, Edge Function errors, payment attempts, refund
    attempts, and crash-free sessions. Prepare an explicit rollback/disable
    decision before starting.

## Read-only production preflight

Run these queries before applying `121_payment_integrity.sql`. Every query must
return zero rows:

```sql
select paymob_txn_id, count(*)
from public.orders
where paymob_txn_id is not null
group by paymob_txn_id
having count(*) > 1;

select order_id, count(*)
from public.order_refunds
where status in ('requested', 'succeeded')
group by order_id
having count(*) > 1;

select provider_ref, count(*)
from public.order_refunds
where provider_ref is not null and provider_ref <> ''
group by provider_ref
having count(*) > 1;
```

After applying `20260724120946_kyc_upload_hardening.sql`, audit the legacy rows
left intentionally unvalidated:

```sql
select id, subject_type, doc_type, storage_path
from public.kyc_documents
where not (
  (
    subject_type = 'driver'
    and doc_type in ('national_id', 'driving_license', 'vehicle_reg')
    and storage_path ~
      ('/driver-' || doc_type || '-[0-9]+\.(jpg|png|webp)$')
  )
  or
  (
    subject_type = 'restaurant'
    and doc_type in ('commercial_reg', 'tax_card', 'food_license')
    and storage_path ~
      ('/restaurant-' || doc_type || '-[0-9]+\.(jpg|png|webp)$')
  )
);
```

Review and remediate every result before a later migration runs:

```sql
alter table public.kyc_documents
  validate constraint kyc_documents_subject_doc_type_check;
```

## Mobile release gate

The driver background-location implementation adds native permissions and a
foreground service. It cannot be delivered safely as JavaScript-only OTA to an
older store binary. Build, review, and install a new binary first. Confirm:

- the location disclosure is visible before pickup;
- foreground and background permissions behave correctly after denial;
- tracking resumes after app backgrounding and device restart scenarios;
- tracking stops on delivery, offline, and sign-out;
- iOS and Android store privacy declarations match actual collection;
- the authenticated Maestro flows pass against staging on both platforms.
