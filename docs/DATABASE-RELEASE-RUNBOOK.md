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

## Mandatory gates

1. Freeze production DDL and keep `CARD_PAYMENTS_ENABLED=false`.
2. Enable a recoverable database backup/PITR plan and test a restore. A schema
   dump alone is not a customer-data backup.
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
