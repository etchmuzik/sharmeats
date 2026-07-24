# kyc-upload — NOT DEPLOYED (staged, no entrypoint)

This directory intentionally has **no `index.ts`** and must not be deployed:
`supabase functions deploy kyc-upload` will fail, and no app calls it.

What it is: staged server-side validation logic for a future upload-proxy flow —
`logic.ts` provides magic-byte image sniffing (`detectKycImage`) and multipart
field parsing (`parseKycUploadFields`), covered by `logic.test.ts` (runs in CI
via `deno test supabase/functions/`).

What ships **today** instead: apps upload directly to the private `kyc` Storage
bucket, and the server-side controls live in
`supabase/migrations/20260724120946_kyc_upload_hardening.sql` — bucket-level
5 MiB size cap + JPEG/PNG/WebP MIME allowlist, insert-only per-user typed paths,
immutability after review, and a forgery-proof `kyc_documents` insert policy.
Bucket MIME enforcement trusts the declared content type; **byte-level sniffing
is NOT active in production** until this function gets an entrypoint and the
apps are switched to upload through it.

To activate later: write `index.ts` (auth → parse multipart via
`parseKycUploadFields` → sniff bytes via `detectKycImage` → service-role upload
with `upsert: false` → insert pending `kyc_documents` row), deploy, then point
`apps/driver/src/kyc.ts` and `apps/restaurant/src/kyc.ts` at it — in that order.
