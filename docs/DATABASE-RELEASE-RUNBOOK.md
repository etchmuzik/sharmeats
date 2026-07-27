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

**Rollback artifact:** `public.__pre_mig126_129_snapshot` (10 rows) holds the
exact pre-apply `pg_get_functiondef` + ACL of every replaced function —
created in the same transaction as the apply, because the off-site backup
script was blocked on the missing Keychain password. Drop the table after the
ledger reconciliation. **Set up `sharmeats-db-password` in the Keychain and
run `./scripts/backup-prod.sh` — the standing no-managed-backups risk below
is unchanged.**

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
