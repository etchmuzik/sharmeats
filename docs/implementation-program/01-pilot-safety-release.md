# Package 01 — pilot safety and release truth

## Outcome

Before public acquisition, prove that Sharm Eats can recover its data, execute
and reconcile the complete COD lifecycle, alert an operator, identify every
live artifact and observe the customer funnel on physical devices.

This package is partly engineering and partly an owner-run verification. Claude
must not replace owner/device evidence with unit tests.

## Current evidence

- `scripts/backup-prod.sh` creates a logical backup and a manifest; commit
  `2dc7027` installed the unattended launchd schedule and added private Storage
  object backup.
- A July 27 backup matched 79 production tables, but a complete isolated restore
  and off-machine retention are still unproven. The attempted local restore is
  currently blocked on installing PostGIS, not on a known corrupt dump.
- `docs/LAUNCH-MONITOR.md` contains useful SQL but no signed execution record.
- PostHog is configured in `apps/customer/eas.json`; production ingestion is
  not yet proven because the key is build-time.
- Web surfaces do not expose a reliable deployed commit SHA.
- CI covers six surfaces, Deno functions and security migrations.
- Mobile apps have `runtimeVersion` and `expo-updates`; older documents claiming
  OTA is missing are stale.

## Expected repository surfaces

- `scripts/backup-prod.sh`, `scripts/backup-storage.sh`, new restore/verifier
  scripts and package scripts;
- `docs/DATABASE-RELEASE-RUNBOOK.md`, lifecycle/device/analytics drill records;
- build scripts plus public version routes/assets in `landing`,
  `apps/admin-web` and `apps/merchant-web`;
- all three mobile `app.json`/`eas.json` release injection and diagnostics UI;
- `apps/customer/src/lib/analytics.ts` and its tests;
- `.github/workflows/` for provenance/drift checks;
- a narrowly authorized diagnostic alert RPC/function if no safe existing test
  hook can prove the path.

## Scope

### 1. Rehearsable database restore

Add:

- `scripts/restore-backup.sh`
- `scripts/verify-restored-backup.sql`
- `docs/RESTORE-DRILL.md`

The script accepts an explicit backup directory and explicit scratch database
URL/name. It must:

1. refuse production-like hosts/project refs;
2. refuse an empty, `/`, home or repository-root target;
3. validate `MANIFEST.txt`, `schema.sql` and `data.sql`;
4. create/use only the named scratch database;
5. load roles when present, otherwise explain the native-dump limitation;
6. load schema, then data with the documented FK-safe setting;
7. run the verifier;
8. write a timestamped drill report outside the backup.

The verifier compares manifestable row counts, required schemas, RLS-enabled
tables, required functions/triggers and auth/public referential integrity.
Storage is explicitly a separate drill; the KYC bucket must be exported and
sample-restored when it contains objects.

Tests:

- shell syntax/static checks;
- refusal tests for unsafe targets;
- restore a fresh backup into local Postgres;
- corrupt/truncated backup fails before mutation;
- verifier fails on a deliberately missing table/function.

Owner evidence:

- copy one encrypted backup to an independent drive/cloud location;
- record location, encryption owner, retention and recovery access;
- complete one drill and attach the report path/date to
  `docs/DATABASE-RELEASE-RUNBOOK.md`.

### 2. Pilot lifecycle test pack

Add:

- `docs/PILOT-LIFECYCLE-TEST.md`
- `supabase/tests/pilot_lifecycle_assertions.sql` (read-only postconditions)

Use real test actors and uniquely prefixed test orders. Cover:

1. COD happy path: place → accept → preparing → ready → dispatch → pickup →
   delivered → COD collected.
2. Merchant reject before preparation.
3. Customer cancel while still legal.
4. Dispatch failure/reassignment/no available driver.
5. Credit issuance for refund/goodwill and customer wallet visibility.
6. Settlement draft → finalize → reference-required paid.
7. Driver cash collection → partial/full hand-in → zero/expected balance.
8. Duplicate status action, duplicate checkout idempotency and repeated cash
   confirmation.
9. Poor-network recovery between each critical transition.

The assertion SQL is read-only and takes explicit UUIDs/short codes. It proves:

- one order, expected terminal status and complete event chain;
- one financial snapshot where required;
- settlement inclusion/exclusion is correct;
- one COD collection ledger entry;
- credit/refund rows reconcile;
- no unresolved finance repair row;
- no impossible active assignment remains.

Never fabricate “pass” data with direct table updates. Drive state through the
same RPCs/apps operators use.

### 3. Release provenance

> **Status 2026-07-27.** Web tooling is **built** (`scripts/write-version-manifest.mjs`,
> `prebuild` wired in all three surfaces, `production-drift.yml`), but **no
> surface serves a manifest yet** — landing 404s and both dashboards return
> HTTP 200 with their SPA HTML 404 page. That is a deploy gap, not a code gap.
> The drift workflow already rejects a non-JSON 200, so it reports this
> correctly. Deploy steps and the body-checking verification command are in
> [`../RELEASE-PROVENANCE.md`](../RELEASE-PROVENANCE.md). The mobile half below
> is still entirely missing.

Add a shared build-time script:

- `scripts/write-version-manifest.mjs`

Wire it into builds for:

- `landing`
- `apps/admin-web`
- `apps/merchant-web`

Generated `/version.json`:

```json
{
  "commit": "<40-char SHA>",
  "builtAt": "<ISO timestamp>",
  "surface": "admin-web",
  "dirty": false
}
```

Rules:

- production builds fail when the source tree is dirty or SHA is unavailable;
- no secrets, environment names, tokens or customer data;
- the generated file is part of the artifact, not a hand-edited claim;
- cache headers must allow operators to fetch the current file.

Add `.github/workflows/production-drift.yml`:

- scheduled and manually dispatchable;
- fetches the three live version manifests;
- compares the intended production SHA supplied by workflow input or release
  tag;
- fails with a surface-by-surface mismatch;
- does not assume every `main` commit has already been deployed.

For mobile:

- expose app version, build number, runtime version, update ID/channel and git
  SHA in an operator-accessible diagnostics block;
- inject SHA at build time, not as a manually maintained constant;
- capture the same release metadata in Sentry/PostHog.

### 4. PostHog funnel proof

Extend `apps/customer/src/lib/analytics.ts` with:

- `app_opened`
- `notification_opened`
- `cart_restored`
- `reorder_prepared`
- `order_delivered`
- `review_prompt_shown`
- `review_prompt_result`

Required common properties:

- app version/build/release SHA;
- locale and display currency;
- anonymous/signed-in state without phone/email;
- acquisition source when known;
- restaurant/vertical/zone identifiers where relevant;
- campaign/event identifier for notification opens.

Rules:

- no phone, address, room number, notes, support text or push token in analytics;
- identify after auth link and reset on sign-out;
- delivery tracking is idempotent per order/device;
- push opens are tracked before routing;
- define the canonical funnel in a checked-in analytics dictionary.

Add `docs/ANALYTICS-DICTIONARY.md` with event owner, trigger, properties and KPI
formula. Verify one physical device produces:

`app_opened → restaurant_viewed → add_to_cart → checkout_opened → order_placed
→ order_delivered → reorder_tapped`.

### 5. Deliberate monitoring exercise

Add a guarded admin-only diagnostic RPC or documented safe procedure that
emits a clearly prefixed TEST ops alert without modifying order/finance state.

Acceptance:

- Telegram receives the alert;
- alert includes environment, timestamp and test marker;
- operator acknowledges using the runbook;
- test alerts are excluded from business incident metrics;
- unauthorized callers cannot trigger it.

### 6. Physical-device matrix

Add `docs/DEVICE-ACCEPTANCE-MATRIX.md` for customer, restaurant and driver on
iOS and Android.

Cover:

- fresh install, upgrade and OTA;
- anonymous → phone-linked account;
- push permission primer/deny/allow/settings;
- foreground/background/killed-app notification and deep link;
- EN/AR/RU/IT/DE, Arabic RTL and long strings;
- offline launch, reconnect and missed Realtime event recovery;
- customer hotel/address selection and tracking;
- restaurant new-order alarm and role controls;
- driver foreground/background location, battery restriction and handoff;
- low storage, old token, shared-device sign-out and token transfer.

Every row records device/OS/build/date/tester/result/evidence link. “Simulator
passed” cannot satisfy a physical-device row.

### 7. Owner security toggles

Document and verify:

- compromised-password protection;
- current Supabase plan backup/PITR status;
- direct DB clients before enabling SSL enforcement/CIDR restrictions;
- database password rotation after the approved path is confirmed;
- admin MFA/AAL2 decision.

These are owner-controlled changes. Claude prepares exact checks and validates
after the owner acts; it does not claim completion from repository code.

## Pilot operating gate

The product proof is paired with a deliberately small operating cohort:

- sign 5–10 pilot LOIs before trying to activate all verbal commitments;
- load and verify each merchant's real menu, hours, prep range, pickup pin,
  payout details and named owner/manager/staff accounts;
- train accept/reject, item 86, storefront pause, chat, cancellation and
  settlement;
- contract/train enough riders for one zone and one dinner window;
- use a signed shift checklist: open merchants, charged tablets, online riders,
  named support owner and reviewed cash balances;
- sign off weekly merchant statements and driver cash hand-ins;
- capture every complaint with an owner and resolution;
- hold paid acquisition until first-order and repeat conversion are measured.

Advance only after at least 50 delivered real orders with acceptance at least
90%, rejection plus cancellation below 8%, zero settlement/cash variance, and no
merchant/rider surprise about money owed.

## Rollout order

1. Restore tooling and local drill.
2. Version manifests and drift workflow.
3. Analytics event additions.
4. Customer production build.
5. Physical-device smoke.
6. Test ops alert.
7. Controlled COD lifecycle rehearsal.
8. Off-machine backup and owner security settings.

## Acceptance gate

Package 01 is complete only when:

- an isolated restore drill has a retained report;
- 10 controlled lifecycle runs have zero order/ledger mismatch;
- all three web surfaces return truthful version manifests;
- mobile diagnostics identify the installed build/update;
- one customer device shows the full PostHog funnel;
- the controlled ops alert was received and acknowledged;
- the device matrix has no P0 failure;
- owner-only security actions are either verified complete or explicitly marked
  as launch blockers with evidence.
