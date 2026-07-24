# Sharm Eats Live Production Audit

**Audit date:** 2026-07-24 (Africa/Cairo)  
**Repository:** `sharmeats` at `a05c601` on `main`  
**Production reviewed:** `sharmeats.online`, `merchant.sharmeats.online`, `admin.sharmeats.online`, Supabase project `ilqpsebcfbaoaogimhud`

## Executive summary

Sharm Eats is online and the current source compiles, but production should be treated as **high operational risk until the database and deployment controls below are repaired**.

No active critical remote-compromise path was confirmed. The strongest controls are working: authoritative order pricing is server-side, important role/financial mutations are narrowed by RPC/RLS and column grants, the public sites use HTTPS, no tracked credential was found, payment cards are disabled in the production customer profile, and the current source passed all available type checks, builds, linters, tests, and Expo Doctor checks.

The main risks are:

1. The repository and production migration histories have **zero matching migration versions**.
2. The Supabase API shows **PITR disabled and no listed restore point**.
3. Three live database functions contain errors that break credit redemption, loyalty redemption, and restaurant KYC rejection.
4. All three live web deployments are demonstrably older than the current source and have no deployed commit identity.
5. KYC evidence can be overwritten by its owner after approval.
6. Expo 52 installs contain critical/high build-chain advisories.

Card payments are currently dark, which prevents the reviewed Paymob defects from being an active money-loss path. They are explicit launch blockers and must be fixed before enabling the card feature flag or deploying the create/refund functions.

### Finding count

| Scope | Critical | High | Medium | Low |
|---|---:|---:|---:|---:|
| Active production/source risk | 0 | 6 | 8 | 2 |
| Dormant card-payment launch blockers | 0 | 3 | 0 | 0 |

## Immediate priorities

### In the next 24 hours

1. Take an encrypted logical database export and a separate Storage object backup; record and test how each can be restored.
2. Freeze ad-hoc production schema changes. Do **not** run `supabase db push` against production while migration history is divergent.
3. Ship a reviewed hotfix migration for `redeem_credit`, `redeem_points`, and `review_kyc_document`.
4. Make KYC objects immutable after upload and constrain the bucket's file size and MIME types.
5. Inventory database clients, then enable SSL enforcement and restrict direct database CIDRs where practical.

### In the next 72 hours

1. Establish a timestamped, reproducible database baseline in a staging project and reconcile production migration history only after schema comparison and restore testing.
2. Build and deploy the three web surfaces from one tagged commit, publish the commit SHA, add security headers, and verify smoke tests.
3. Patch Next.js to at least `15.5.21` and plan the Expo SDK upgrade/remediation.
4. Add CI build, audit, migration-reset, and missing behavioral test gates.

## High findings

### H-01 — Production migration history is completely divergent

**Evidence**

- `supabase migration list --linked` reported **119 local-only**, **81 remote-only**, and **0 matched** migrations.
- Local versions are numbered `001` through `119`; remote versions are timestamped values such as `20260701170213` through `20260718011603`.
- Supabase compares migration timestamps, so these are not equivalent history entries even where live objects happen to resemble repository SQL. See the [Supabase migration documentation](https://supabase.com/docs/guides/deployment/database-migrations).

**Impact**

- A normal `db push` cannot safely determine what remains to run and may try to replay historical migrations.
- Production cannot be reproduced reliably from the repository.
- Schema drift, rollback, incident reconstruction, and review of what actually changed are unreliable.

**Required fix**

1. Freeze direct Dashboard/SQL-editor schema changes.
2. Export the live schema and compare it to a clean database built from repository migrations.
3. Create a canonical timestamped baseline and test it in a new staging project.
4. Reconcile migration history only after proving schema equivalence. Do not blindly mark every migration applied.
5. Make one CI/CD path responsible for future production migrations and require `db reset`/schema tests in CI.

**False-positive note:** live lint results show that many source definitions are present in production, but object similarity does not repair or validate the migration ledger.

### H-02 — No recoverable production restore point was demonstrated

**Evidence**

- `supabase backups list` returned `pitr_enabled: false`, `backups: []`, and empty physical-backup data.
- The project reports WAL-G enabled, but the audit could not identify an operator-accessible restore point.
- Supabase states that daily backup retention depends on plan and recommends regular off-site CLI exports for free-tier projects. Database backups also do not restore deleted Storage objects. See [Supabase database backups](https://supabase.com/docs/guides/platform/backups).

**Impact**

- A bad migration, credential compromise, destructive operator action, or provider incident may cause unrecoverable order, customer, finance, settlement, and KYC metadata loss.
- Recovery-point and recovery-time objectives are unknown and untested.

**Required fix**

- Take an encrypted logical backup now and retain it outside the Supabase project.
- Back up Storage objects separately.
- Enable an appropriate daily-backup/PITR plan for the business RPO.
- Run a documented restore into an isolated project and verify row counts, auth relationships, functions, RLS, and Storage references.

**False-positive note:** the provider may retain infrastructure-internal material that the command does not expose. That is not an operational restore plan until Sharm Eats can select and successfully restore it.

### H-03 — Three live RPC paths fail at runtime

**Evidence**

The linked production `supabase db lint --level error` run found:

- `redeem_credit` calls unqualified `gen_random_bytes(16)` while its fixed search path is only `public, pg_temp`: `supabase/migrations/062_money_foundation.sql:150-181`, especially line 169.
- `redeem_points` has the same defect: `supabase/migrations/113_redeem_points_owner_binding.sql:21-62`, especially line 47.
- `review_kyc_document` writes `public.restaurants.verified`, but that column does not exist: `supabase/migrations/075_kyc_and_vat.sql:81-117`, especially line 111.

**Impact**

- Customers cannot turn credit balances into usable promo codes.
- Customers cannot redeem loyalty points.
- Rejecting a restaurant KYC document fails and rolls the transaction back, leaving its status unchanged. The driver rejection path uses `drivers.is_verified` and is not affected by this specific column error.

**Required fix**

- Schema-qualify the cryptographic function, for example `extensions.gen_random_bytes(16)`, in both RPCs.
- Decide the canonical restaurant verification field. Either add and consistently govern it, or remove/change the invalid update.
- Deploy these corrections as a new migration, then test success, insufficient-balance, rollback, approval, and rejection cases with authenticated staging users.

**False-positive note:** the linter also reported `_lines` inside `place_order`. That warning was excluded because the function creates the temporary `_lines` table before use.

### H-04 — Live web artifacts are stale and have no trustworthy provenance

**Evidence**

| Surface | Live `Last-Modified` | Source commits after that date | Artifact comparison |
|---|---|---:|---|
| Landing | 2026-07-04 | 4 | live/current chunk hashes differ |
| Merchant | 2026-07-02 | 12 | live/current chunk hashes differ |
| Admin | 2026-06-27 | 18 | live/current chunk hashes differ |

The live and freshly built chunk sets differ on all three sites. The current source builds cleanly, but no public version/commit manifest identifies what production runs. Hostinger deployment is a manual static upload workflow; CI does not deploy or smoke-test production.

**Impact**

- Merged bug/security fixes are not necessarily live.
- Operators cannot prove which code handled a production action.
- Rollback and incident response depend on manual file state rather than a known release artifact.

**Required fix**

- Build immutable artifacts from a tagged commit in CI.
- Include a non-secret `/version.json` containing commit SHA and build time.
- Deploy atomically, retain the previous artifact, and run login/public-route/API smoke tests.
- Alert when production SHA differs from the intended release.

**False-positive note:** file timestamps alone can be preserved during upload, but the differing chunk hashes independently confirm that production is not the current build.

### H-05 — Expo 52 build chains contain critical/high advisories

**Evidence**

All three native apps pin Expo 52:

- `apps/customer/package.json:17-55`
- `apps/driver/package.json:12-40`
- `apps/restaurant/package.json:12-39`

`npm audit --omit=dev` reported:

| App | Critical | High | Total |
|---|---:|---:|---:|
| Customer | 2 | 24 | 31 |
| Driver | 1 | 22 | 27 |
| Restaurant | 1 | 18 | 23 |

Examples include command injection/DoS in `shell-quote` and archive traversal/overwrite/DoS issues in `tar`, reached mainly through Expo CLI/config/build dependencies.

**Impact**

- A malicious archive, dependency, or build input can threaten developer/CI build machines or make builds unavailable.
- The large unsupported dependency gap makes future security updates increasingly disruptive.

**Required fix**

- Plan and test a supported Expo SDK upgrade for all three apps, using Expo's compatibility tooling and native regression builds.
- Where an SDK upgrade cannot be immediate, validate safe lockfile overrides for individually patchable transitive packages.
- Keep builds isolated, lockfile-exact, least-privileged, and free of long-lived signing/provider secrets.

**False-positive note:** most of the critical/high paths are CLI/build-time dependencies, not remotely reachable JavaScript inside the installed mobile app. That is why this is High supply-chain risk rather than a confirmed Critical device exploit. All three apps passed Expo Doctor.

### H-06 — An owner can replace KYC evidence after it is approved

**Evidence**

- The KYC Storage policy explicitly allows an authenticated owner to update any object in their UID prefix: `supabase/migrations/076_kyc_storage_policies.sql:36-47`.
- Both native clients upload with `upsert: true`: `apps/driver/src/kyc.ts:57-65` and `apps/restaurant/src/kyc.ts:44-51`.
- Approval is stored on the `kyc_documents` row, but no control binds that approval to an immutable object version or checksum.
- No migration creates/configures the claimed `kyc` bucket with a file-size limit or allowed MIME list.

**Impact**

- A driver or restaurant can replace the bytes behind an already approved `storage_path` while the database row remains approved.
- This defeats the evidence trail and creates identity, licensing, fraud, and compliance risk.

**Required fix**

- Remove owner UPDATE permission on KYC objects and use insert-only uploads with `upsert: false`.
- Generate collision-resistant immutable paths, record object version/checksum/size/MIME, and make re-submission create a new pending row.
- Provision the private bucket in migration/configuration with explicit file-size and MIME constraints.
- Validate actual bytes, not only the caller-provided `image/jpeg` metadata.

## Medium findings

### M-01 — Direct database traffic is internet-wide and SSL is not enforced

**Evidence**

- Live SSL enforcement: `database: false`.
- Live network restrictions: IPv4 `0.0.0.0/0`, IPv6 `::/0`.

Supabase HTTP APIs still enforce HTTPS; this finding concerns direct Postgres and pooler connections. Supabase recommends SSL enforcement and supports CIDR restrictions before traffic reaches database authentication. See [SSL enforcement](https://supabase.com/docs/guides/platform/ssl-enforcement) and [network restrictions](https://supabase.com/docs/guides/platform/network-restrictions).

**Impact**

- A leaked database credential is usable from anywhere.
- A misconfigured client may connect without transport encryption.
- Brute-force and credential-stuffing exposure is broader than necessary.

**Required fix**

- Inventory all direct DB/pooler clients, configure `sslmode=verify-full` with the Supabase CA, then enable SSL enforcement during a planned brief reboot.
- Restrict CIDRs to operator/build egress where practical; Edge functions using `supabase-js` do not require direct DB access.
- Rotate the database password after enforcing the new access path.

### M-02 — Admin/merchant bearer sessions lack browser hardening

**Evidence**

- All three live sites return only `Content-Security-Policy: upgrade-insecure-requests`.
- HSTS, `frame-ancestors`/`X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`, and `Permissions-Policy` were absent.
- The checked-in Hostinger configs set caching/rewrites but not security headers: `landing/public/.htaccess:28-43`, `apps/merchant-web/public/.htaccess:26-33`, and `apps/admin-web/public/.htaccess:26-33`.
- Admin and merchant sessions are deliberately persisted in browser localStorage: `apps/admin-web/src/lib/supabase/client.ts:1-29` and `apps/merchant-web/src/lib/supabase/client.ts:1-29`.

**Impact**

- Any future XSS has a straightforward path to privileged bearer-token theft.
- The dashboards can be framed for clickjacking.
- Browser MIME/referrer/feature protections remain at defaults.

**Required fix**

- Introduce a tested CSP in report-only mode, then enforce at minimum `default-src`, `script-src`, `connect-src`, `img-src`, `style-src`, `object-src 'none'`, `base-uri`, `form-action`, and `frame-ancestors 'none'`.
- Add HSTS after confirming every subdomain is HTTPS-only, plus `nosniff`, a strict referrer policy, and a minimal permissions policy.
- Require MFA/AAL2 for admins and consider an HttpOnly-cookie/BFF architecture for privileged dashboards.

**False-positive note:** no exploitable first-party XSS sink was found, and source maps were not publicly retrievable. This is defense-in-depth around high-value sessions, not proof of present token theft.

### M-03 — Web dependencies have patchable high advisories

**Evidence**

- Admin, merchant, and landing pin `next: 15.5.19`: `apps/admin-web/package.json:14-20`, `apps/merchant-web/package.json:15-21`, `landing/package.json:13-18`.
- Production audits reported 4, 4, and 3 high findings respectively.
- The direct Next.js advisories are fixed by `15.5.21`; related `postcss` and `sharp` findings also resolve through the patched Next release.

**Impact**

- The current static exports are not running Server Actions, rewrites, or the Next image server, so the highest server-only advisory paths are not exposed on Hostinger.
- Build tooling still processes vulnerable `postcss`/`sharp` versions, and future deployment as a Next server would expose additional paths.

**Required fix**

- Upgrade Next and `eslint-config-next` together to at least `15.5.21`, refresh lockfiles, rerun audits, builds, and live static smoke tests.

### M-04 — CI can silently broaden installs and skip missing controls

**Evidence**

- `.github/workflows/ci.yml:41-46` falls back from lockfile-exact `npm ci` to mutating `npm install`.
- Typecheck, test, and lint use `--if-present`: `.github/workflows/ci.yml:48-58`.
- Driver, restaurant, admin, and landing have no behavioral tests; only customer and merchant tests ran.
- CI does not build production artifacts, run `npm audit`, reset/test migrations, or compare deployment SHA.
- `actions/checkout` and `actions/setup-node` use mutable major tags while the Deno setup action is commit-pinned.

**Impact**

- Lockfile drift can pass CI with a different dependency graph.
- Removing or misspelling a quality script can turn a required check into a pass.
- Critical driver/admin/order-state regressions can ship despite green type checks.

**Required fix**

- Make `npm ci` failure fatal and require each expected script explicitly.
- Add web production builds, dependency/license/security audits, migration reset/lint tests, and meaningful tests for admin, driver, restaurant, and landing flows.
- Pin third-party actions by commit SHA and enable dependency update automation.

### M-05 — Compromised-password protection is disabled

**Evidence**

The linked Supabase security advisor reported leaked-password protection disabled. Customer use is primarily anonymous/phone OTP, but merchant/admin dashboards support password-based identities.

**Impact**

- Known-breached passwords can be accepted for privileged operational accounts.

**Required fix**

- Enable compromised-password detection.
- Require MFA/AAL2 for admins and high-risk merchant actions.
- Review OTP/password rate limits, recovery flows, and privileged-account inventory.

### M-06 — Database privileges remain broader than intended

**Evidence**

The live security advisor still reports:

- multiple functions executable by `anon`/PUBLIC, including SECURITY DEFINER functions;
- a security-definer `public_drivers` projection;
- RLS disabled on extension-owned `spatial_ref_sys`;
- PostGIS/pg_net extensions installed in `public`.

Source review found important mitigations: sensitive RPCs generally re-check `auth.uid()`/role; `public_drivers` is a read-only projection with write grants revoked; and `spatial_ref_sys` has a write-blocking trigger.

**Impact**

- Current guards reduce immediate exploitability, but default PUBLIC EXECUTE and schema-wide grants increase the blast radius of any future fail-open function.
- Security-advisor noise makes real regressions harder to detect.

**Required fix**

- Revoke PUBLIC/anon execute from every function that is not intentionally public, then explicitly grant exact roles.
- Add `TO authenticated`/`TO anon` to policies rather than relying only on predicates.
- Move extensions out of `public` where supported and document accepted exceptions with automated tests.

### M-07 — OTP account-linking state is volatile

**Evidence**

- `pendingVerifyType` is module-scoped and defaults to `sms`: `apps/customer/src/data/supabase/auth.ts:24-30`.
- Anonymous account linking changes it to `phone_change`, then the OTP screen later consumes it: `apps/customer/src/data/supabase/auth.ts:81-132`.

**Impact**

- If the app process reloads, an update is delivered, or navigation reconstructs the module between send and verify, the verification type resets.
- The customer can fail verification or sign into/create a different phone account, orphaning the anonymous user's cart/order history.

**Required fix**

- Persist the pending verification flow, normalized phone, expiry, and originating user ID in secure app storage.
- On verify, re-read the current session and reject inconsistent state rather than falling back.
- Add cold-start and OTA-reload tests around guest-to-phone linking.

### M-08 — Public intake endpoints have no application-level abuse control

**Evidence**

- `driver_applications` permits unauthenticated inserts with only length/status checks: `supabase/migrations/108_driver_provisioning_and_applications.sql:37-57`.
- Anonymous auth is intentionally enabled for guest ordering.
- No CAPTCHA, device/IP throttle, duplicate suppression, or queue cap was found in repository code.

**Impact**

- Automated clients can create spam applications or large numbers of anonymous users, consuming database/Auth/SMS/ops capacity.

**Required fix**

- Put public submissions behind a rate-limited Edge function, CAPTCHA/turnstile or equivalent abuse signal, normalized duplicate detection, and monitoring.
- Apply conservative Auth/OTP limits without breaking hotel guests and test the expected tourist traffic pattern.

## Low findings

### L-01 — Edge functions return excessive internal/provider detail

Examples include raw exception strings and Paymob response bodies: `supabase/functions/paymob-create-intention/index.ts:91-99` and `supabase/functions/paymob-refund/index.ts:126-145`.

Return stable public error codes, log redacted diagnostics server-side, and attach correlation IDs. The deployed Paymob webhook currently lacks its Paymob secret and therefore fails closed; create/refund are not deployed.

### L-02 — Several edge endpoints accept broader methods/CORS than required

The Paymob create/refund functions advertise POST but do not explicitly reject other methods, and use wildcard CORS. Require POST, cap body size, validate schemas, and narrow origins where browser callers are known. Bearer tokens rather than cookies limit classic CSRF impact.

## Dormant card-payment launch blockers

These are **High severity if card payments are enabled**, but are not active money-loss paths today:

- `apps/customer/eas.json:21-31` sets `EXPO_PUBLIC_PAYMENTS_CARD_ENABLED` to `false`.
- `paymob-create-intention` and `paymob-refund` are not deployed.
- No `PAYMOB_*` secrets are present in the project's secret-name inventory.

### P-01 — Webhook signature is not bound to the selected Sharm Eats order

`supabase/functions/paymob-webhook/verify.ts:11-32` signs Paymob's `order.id`, but `resolveOrderId` deliberately selects unsigned `merchant_order_id`, `special_reference`, or `extras.order_id` at lines 66-68. The webhook then locates a Sharm Eats order by that unsigned ID and validates only that its amount matches: `supabase/functions/paymob-webhook/index.ts:98-140`.

A valid signed callback can therefore be replayed with a changed unsigned order reference against another pending order of the same amount. Persist the expected Paymob order/intention ID at creation, require the signed `obj.order.id` and signed transaction/integration/currency to match it, and enforce unique transaction processing.

### P-02 — Payment intention creation is not idempotent

Every eligible call creates a new Paymob intention without first claiming/reusing a payment attempt: `supabase/functions/paymob-create-intention/index.ts:56-97`.

Retries or double taps can create multiple payable checkouts. If more than one is paid, the first webhook changes the order to paid and later valid charges become no-ops, leaving a double charge outside order state. Store payment attempts, allow only one active attempt per order, use provider idempotency where available, and reconcile every provider transaction.

### P-03 — Refund execution is race-prone and partial refunds corrupt state

`supabase/functions/paymob-refund/index.ts:80-143` reads `paid`, inserts an attempt, calls Paymob, then marks the whole order `refunded`. There is no atomic claim or uniqueness constraint preventing two concurrent admins from issuing the provider call. A partial refund also marks the entire payment refunded.

Use a database RPC to atomically claim a refund idempotency key, enforce unique successful refund/provider references, track cumulative refunded cents, distinguish partial/full state, and reconcile unknown/crash outcomes before retry.

## Controls verified as working

- All six TypeScript checks passed.
- Merchant, admin, and landing production builds passed.
- All three web linters passed.
- Customer: 106 tests passed; merchant: 1 test passed; Edge/Deno: 25 tests passed.
- All three Expo projects passed 18/18 Expo Doctor checks.
- Latest GitHub CI run on `main` passed.
- Supabase performance advisor reported no issues; no blocking lock was observed.
- Production HTTPS endpoints returned HTTP 200 and did not expose JavaScript source maps in the tested paths.
- Current tracked files did not contain a live service-role, Paymob HMAC, or private payment key; environment/credential paths are ignored.
- Production table grants prevent ordinary authenticated clients from updating sensitive `users.role`, `users.is_blocked`, broad restaurant fields, or arbitrary order state.
- `place_order` recomputes price server-side and has per-user/idempotency locking.
- Paymob HMAC comparison is constant-time and signed amount validation is unit-tested.
- `expo-push` is protected by an internal secret, and that secret is present.
- The public `public_drivers` view is intentionally limited to non-sensitive fields and has write privileges revoked.
- The `spatial_ref_sys` advisor warning has a database trigger preventing app-role writes.

## Scope and limitations

The audit reviewed source/configuration, lockfile advisories, current CI, live public HTTP behavior, linked Supabase migrations/advisors/backups/network/SSL settings, table/index/lock health, deployed Edge-function inventory, and secret **names only**.

It did not:

- place/cancel a real production order;
- create test users or mutate production data;
- execute a real Paymob charge/refund;
- inspect App Store/Play Store binaries or remote EAS signing credentials;
- conduct destructive penetration, stress, SMS-abuse, or disaster-restore testing;
- inspect Sentry events or Hostinger account/audit logs.

Those require controlled test identities, provider coordination, or a maintenance window. They should be the next validation phase after the High findings are remediated.
