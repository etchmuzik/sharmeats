# Sharm Eats Mobile Production Audit

> **Note:** written mid-remediation; the same-day final-state review (32-agent
> pass, see the 2026-07-24 commit series) fixed several findings listed here as
> open — cross-check `docs/AUDIT-REPORT-2026-07-24.md` and the commit messages
> before acting on an individual finding.

**Audit date:** 2026-07-24 (Africa/Cairo)  
**Apps:** Customer, Driver, Restaurant  
**Platforms:** iOS and Android  
**Source revision reviewed:** `a05c601` plus the uncommitted audit fixes listed below  
**Production safety:** No production data was mutated and no store build, OTA update, or database migration was deployed.

## Executive decision

The three app source trees compile, pass Expo compatibility checks, and export
both iOS and Android JavaScript bundles. No confirmed P0 remote-device compromise
or checkout-price bypass was found.

The repository is materially safer after this audit, but it is **not yet safe to
declare the live system fully remediated**. The source fixes must go through a
staging database and real-device smoke pass before release. Production database
migration history is divergent, so running `supabase db push` is specifically
unsafe. Driver background tracking and the Expo 52 dependency chain remain the
two largest mobile release risks.

### Current app verdict

| App | Source verdict | Live release action |
|---|---|---|
| Customer | Release candidate after migration 120 and device smoke | JS fixes are OTA-compatible only when the installed binary runtime is the same app version; otherwise submit a store build |
| Driver | Release candidate except for background-tracking limitation | Native iOS/Android build required; do not promise continuous tracking in background yet |
| Restaurant | Release candidate after migration 120 and kitchen-tablet smoke | Native iOS/Android build required |

## Verification results

| Control | Customer | Driver | Restaurant |
|---|---:|---:|---:|
| Strict TypeScript | Pass | Pass | Pass |
| Vitest | 112 pass | 13 pass | 9 pass |
| Expo Doctor | 18/18 | 18/18 | 18/18 |
| iOS Expo export | Pass | Pass | Pass |
| Android Expo export | Pass | Pass | Pass |
| Reproducible lock install | Pass | Pass | Pass |
| Production dependency audit | 23 findings | 21 findings | 21 findings |

Production dependency-audit detail:

| App | Critical | High | Moderate | Low |
|---|---:|---:|---:|---:|
| Customer | 1 | 18 | 4 | 0 |
| Driver | 1 | 16 | 4 | 0 |
| Restaurant | 1 | 16 | 4 | 0 |

Most remaining critical/high dependency paths are in Expo CLI/config/build
tooling rather than remotely reachable app JavaScript. They still matter on
developer and CI machines. `npm audit fix --force` is not acceptable: npm's
proposed remediation jumps the projects across Expo SDK generations.

Mobile-owned backend verification also passed:

- The mobile-audit baseline Deno-checked every Edge Function and passed all 25
  tests that existed at that point.
- Migration 120 executed successfully in an isolated PostgreSQL 18 harness.
  Legacy push-token deduplication/transfer, credit redemption, loyalty
  redemption, and restaurant KYC rejection all passed behavioral assertions.
- Linked production database lint confirmed the three runtime function defects
  described below.
- No tracked live service-role key, private signing key, or payment secret was
  found. Local credential directories are ignored.
- Customer locale files have parity: Arabic, German, English, Italian, and
  Russian each contain 449 keys.

**Current shared-worktree warning:** A separate Paymob workstream appeared after
the mobile verification. Its 35 Deno tests pass, but the full `deno check`
currently fails because `paymob-webhook/index.ts` still imports the removed
`resolveOrderId` export. Those concurrent user-owned edits were preserved and
not folded into this mobile change set. The Edge Function CI job is red until
that workstream integrates its entrypoints.

## Fixed during this audit

These changes exist in source. Items involving migration 120 are not active in
production until the migration has been safely staged and deployed.

### MOB-H01 — Guest phone verification could change account after an app restart

**Status:** Fixed and covered by 5 regression tests.

The customer app kept the pending OTP type only in module memory. A process
restart, OTA reload, or memory eviction reset it to ordinary SMS verification.
For a guest checkout that should link a phone to the anonymous user, this could
switch `auth.uid()` and orphan the customer's guest orders.

The app now persists the normalized phone, OTP flow type, originating user, and
10-minute expiry in AsyncStorage. Verification fails closed when state is
missing, expired, mismatched, or belongs to a different anonymous session.

**Source:** `apps/customer/src/data/supabase/auth.ts`

### MOB-H02 — Restaurant screens dropped hotel, room, street, and beach details

**Status:** Fixed and covered by 8 order tests.

`place_order` stores an address snapshot with database-style snake_case keys,
while the restaurant UI reads camelCase. Initial queries and Realtime events now
pass through one normalization boundary, so the kitchen receives the complete
handoff address.

**Source:** `apps/restaurant/src/orders.ts`

### MOB-H03 — KYC evidence could be replaced after approval

**Status:** Client fixed; database part awaits migration 120.

Driver and restaurant uploads used `upsert: true`, while Storage policy allowed
owners to update an existing object. The bytes at an approved path could
therefore change without resetting the approved database row.

Both apps now use insert-only uploads. Migration 120 removes the owner UPDATE
policy. A replacement is a new timestamped object and a new pending document.

**Source:** `apps/driver/src/kyc.ts`,
`apps/restaurant/src/kyc.ts`,
`supabase/migrations/120_runtime_and_kyc_integrity_fixes.sql`

### MOB-H04 — Three live database actions fail at runtime

**Status:** Source migration written; not deployed.

Linked production lint confirmed:

- `redeem_credit` cannot resolve `gen_random_bytes`.
- `redeem_points` cannot resolve `gen_random_bytes`.
- Rejecting restaurant KYC writes a nonexistent `restaurants.verified` column.

Migration 120 schema-qualifies cryptographic calls, preserves the current
owner-bound one-use reward behavior, and removes the invalid restaurant update.
It also narrows function execution grants.

**Source:** `supabase/migrations/120_runtime_and_kyc_integrity_fixes.sql`

### MOB-H05 — A shared device could receive the previous account's pushes

**Status:** Clients fixed; database part awaits migration 120.

`push_tokens` was unique only by `(user_id, token)`. The same physical device
token could therefore remain registered under multiple accounts. A missed
sign-out cleanup followed by another login could expose private order, offer, or
kitchen notifications to the wrong user.

Migration 120 deduplicates legacy rows, makes the token globally unique, and
adds an authenticated transfer RPC. All three apps now register through that
RPC. Sign-out cleanup remains as defense in depth.

**Source:** `apps/customer/src/data/supabase/user.ts`,
`apps/driver/src/push.ts`, `apps/restaurant/src/push.ts`,
`supabase/migrations/120_runtime_and_kyc_integrity_fixes.sql`

### MOB-M01 — Driver and restaurant had no behavioral test command

**Status:** Fixed.

Vitest is now configured in both apps. New tests cover driver geometry parsing,
job/address normalization, immutable KYC upload, restaurant order visibility,
allergen labels, address normalization, and immutable KYC upload.

### MOB-M02 — Long shifts could expire sessions or leave startup spinning

**Status:** Fixed.

Driver and restaurant now start/stop Supabase token auto-refresh with app state.
Initial `getSession()` failures always leave loading state and safely resolve to
signed-out instead of trapping the app on startup.

**Source:** `apps/driver/src/auth.tsx`, `apps/restaurant/src/auth.tsx`,
and both root layouts

### MOB-M03 — Uncaught route errors could white-screen an active operation

**Status:** Fixed.

Driver and restaurant now export Expo Router error boundaries with Sentry
capture, retry, and home recovery. Duplicate Sentry config-plugin entries were
also removed.

### MOB-L01 — Driver map parser accepted malformed geometry

**Status:** Fixed and covered by 9 tests.

The parser now accepts only the exact little-endian WGS84 Point EWKB shape and
valid longitude/latitude bounds. It rejects trailing bytes, wrong geometry
types, wrong SRIDs, and malformed data.

## Open release risks

### MOB-H06 — Driver tracking stops while the app is backgrounded

**Severity:** High operational risk  
**Status:** Open; requires native work and policy review.

Driver tracking uses `watchPositionAsync` with foreground permission only.
The source itself notes that fixes stop while Google Maps or another app is in
front. The app re-seeds location on return, but the customer live dot and
dispatch position are stale during the journey.

This is not safely fixable as a silent JavaScript patch. It requires:

1. `startLocationUpdatesAsync` plus a defined background task.
2. iOS background location mode and Always/appropriate authorization behavior.
3. Android background-location/foreground-service permissions and a persistent
   notification.
4. Updated App Store/Play privacy declarations and user-facing disclosure.
5. Battery, process-kill, denied-permission, and long-drive testing on real
   iOS and Android devices.

**Evidence:** `apps/driver/src/location.ts:44-135`,
`apps/driver/app/home.tsx:93-109`, `apps/driver/app.json:16-43`

### MOB-H07 — Production migration history is not deployable normally

**Severity:** High operational risk  
**Status:** Open.

The same-day production audit found 119 local-only migrations, 81 remote-only
migrations, and zero matching versions. Migration 120 must not be sent with a
blind `supabase db push`. First create a staging baseline from live schema,
compare it to source, reconcile history deliberately, and prove restore.

The local Docker daemon was unavailable during this audit, so the entire
Supabase history could not receive a clean `db reset`. Migration 120 itself did
execute successfully against a purpose-built isolated PostgreSQL harness,
including behavioral checks for every changed function. A full staging project
with Supabase Auth, Storage, RLS, extensions, and the production schema remains
a release gate.

### MOB-H08 — Expo 52 supply-chain advisories remain

**Severity:** High build/CI risk  
**Status:** Open.

Safe lockfile refreshes reduced the production audit totals, but the remaining
fixes require a coordinated Expo SDK upgrade. Do that as a dedicated release:
upgrade one SDK step at a time where required, use Expo's compatibility checks,
generate clean native projects/builds, and rerun the entire permission,
notification, auth, order, maps, and KYC matrix.

### MOB-M04 — Driver and restaurant lack OTA configuration

**Severity:** Medium  
**Status:** Open.

Customer has an EAS Update URL, production channel, and app-version runtime
policy. Driver and restaurant have no update URL, runtime policy, or production
channel and do not include `expo-updates`. Operational fixes for those apps
currently require store builds and review.

Add OTA only as a planned native release, with runtime versioning, rollback
ownership, staged rollout, and a rule that native/config changes never ship to
an incompatible runtime.

### MOB-M05 — KYC upload type and size are not server-constrained

**Severity:** Medium  
**Status:** Open.

The clients label selected files as JPEG, but the repository does not provision
the KYC bucket with a MIME allow-list or file-size ceiling and does not validate
actual bytes. Add private-bucket configuration, conservative size limits,
allowed image/PDF types, magic-byte validation, and malware/document processing
appropriate to the compliance workflow.

### MOB-M06 — Device-level end-to-end coverage is still missing

**Severity:** Medium  
**Status:** Open.

Bundle export proves Metro can produce JavaScript, not that App Store/Play
binaries sign, install, receive pushes, play sounds, survive backgrounding, or
obey OS permissions. No real production order, SMS, push, KYC review, COD
handoff, card transaction, or account deletion was executed in this audit.

### MOB-L02 — Driver and restaurant are English-only

**Severity:** Low/product risk  
**Status:** Open.

Customer has five complete locales and direction handling. Driver and restaurant
hard-code English operational copy. For the Sharm workforce, Arabic localization
and RTL device testing should be scheduled, particularly permission, safety,
allergen, error, and cash-collection language.

### Dormant card-payment blockers

Customer production configuration keeps card payments disabled. Keep that flag
off. The broader security audit identified three launch blockers: webhook/order
binding, payment-intention idempotency, and concurrent/partial refund accounting.
They must be resolved and tested with provider sandbox transactions before card
payments are enabled. A concurrent workstream has started migration 121 and
supporting helpers for these issues, but at this report's cutoff the helpers are
not integrated into the Edge Function entrypoints and full Deno checking fails.
Treat all three blockers as open until that work is complete and staged.

## Required real-device audit matrix

Run every applicable scenario once on current iOS and Android release-candidate
builds, using staging accounts and a staging database.

### Customer

- Fresh install, upgrade install, offline launch, and denied notification/location.
- Guest COD order from restaurant selection through delivered state.
- Kill the app on the OTP screen, relaunch, verify the same guest identity and
  order ownership remain.
- Returning-phone login and wrong/expired/resend OTP.
- Hotel/room/handoff, street/building/apartment, and beach-pin addresses.
- Price/modifier/allergen/note parity between cart, server order, restaurant, and
  driver.
- Realtime tracking across foreground/background/connection loss.
- Warm and cold notification taps for order, chat, and support.
- Sign out, second account on the same phone, and proof that no old push arrives.
- Account deletion with and without an active order.

### Driver

- Fresh sign-in, unregistered/blocked/unverified driver, and 8-hour foreground shift.
- Deny/revoke location and notifications before and during a job.
- Online/offline, offer timeout, accept race, reject, and Realtime reconnect.
- Restaurant pickup coordinates and every customer address type.
- Ready → picked up → out for delivery → delivered transitions.
- Cash collection amount, duplicate tap, network timeout, and retry.
- Open external navigation, lock the phone, background for 10+ minutes, and
  measure customer/dispatch position freshness.
- Process kill and restart during each active-delivery state.
- Push offer with app foregrounded, backgrounded, and killed.
- Sign out mid-job and shared-device account switch.

### Restaurant

- Fresh sign-in, unauthorized staff, blocked account, and 8-hour kitchen shift.
- New COD order via Realtime and push; verify repeat chime and mute behavior.
- Reconnect after an order arrives while offline and prove the queue resyncs.
- Paid-card visibility only in the future sandbox flow; unpaid card stays hidden.
- Accept, reject, preparing, ready, and terminal transition permissions.
- Hotel room, street, beach pin, kitchen notes, item modifiers, and allergen banner.
- Duplicate status taps and network timeout/retry.
- Push and chime behavior in foreground, background, killed, and silent modes.
- KYC new submission and resubmission without overwriting approved evidence.
- Shared-tablet sign out/account switch with no previous-restaurant push.

## Safe deployment sequence

1. Take and verify encrypted database and Storage backups.
2. Create an isolated staging project from a canonical live-schema baseline.
3. Run migration 120 transactionally in staging. Test push-token transfer, both
   reward redemptions, driver/restaurant KYC approve/reject, and re-upload.
4. Run the complete device matrix on signed iOS and Android release candidates.
5. Release customer to a small cohort. Use OTA only if the installed runtime
   version is proven compatible.
6. Submit new native driver and restaurant builds. Do not claim background
   tracking until MOB-H06 is implemented and verified.
7. Monitor Sentry errors, auth failures, push receipt errors, order-state errors,
   KYC review failures, and location freshness through the rollout.
8. Roll back app artifacts if needed; database rollback must be a new reviewed
   forward migration.

## Quick wins

### Completed in source

- 28 new mobile regression tests; total mobile tests now 134.
- Persistent, fail-closed customer OTP linking.
- Complete restaurant delivery-address normalization.
- Immutable KYC client uploads and a matching policy migration.
- Push-token single-account ownership.
- Session refresh and startup recovery for long shifts.
- Driver/restaurant route crash recovery.
- Stricter driver coordinate decoding.
- Duplicate Sentry plugin cleanup.
- Safe dependency lock refresh without forced cross-SDK upgrades.
- Mobile CI now requires lockfile-exact installs, typecheck/test scripts, and a
  pinned Expo Doctor compatibility gate.

### Next 24 hours

- Back up database and Storage; test that the backup is readable.
- Establish the staging schema baseline and execute migration 120 there.
- Run one iOS and one Android happy-path smoke per app.

### Next 7 days

- Implement and certify driver background tracking.
- Plan the Expo SDK upgrade and produce clean internal-distribution builds.
- Add KYC bucket constraints and content validation.
- Add Detox/Maestro or equivalent signed-build smoke automation for the critical
  customer order, driver handoff, and restaurant queue flows.
- Add driver/restaurant EAS Update only with an explicit runtime/rollback plan.

## Audit limitations

This was a non-destructive source, configuration, dependency, bundle, test, and
linked-database-lint audit. It did not inspect App Store Connect/Play Console
review metadata, download and reverse-engineer the currently published binaries,
access Sentry production events, send live SMS/push traffic, alter production
schema/data, conduct stress testing, or execute a disaster restore. Those are
separate controlled production-readiness activities.
