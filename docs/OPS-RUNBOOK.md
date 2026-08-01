# Sharm Eats — Operations Runbook

**Ongoing** production operations: backup/restore, disaster recovery, incident
response, and the abuse/rate-limit posture. (For *initial* go-live config —
domain, Paymob secrets, first deploy — see [LAUNCH-RUNBOOK.md](./LAUNCH-RUNBOOK.md).
For live launch-day metrics SQL, see [LAUNCH-MONITOR.md](./LAUNCH-MONITOR.md).)

- **Supabase project ref:** `ilqpsebcfbaoaogimhud`
- **Prod DB:** Supabase Postgres (all business data)
- **Public edge functions:** `paymob-webhook`, `expo-push` (both `--no-verify-jwt`)

---

## 1. Database backup & Point-in-Time Recovery (PITR)

**Everything that matters lives in the Supabase Postgres DB.** Losing it loses
orders, money records, users, KYC, settlements. This is the single most important
thing to have a recovery plan for.

### What's in place — read this before trusting anything below

**The project is on the Supabase FREE plan. There are NO managed backups and NO
PITR.** Verified against the Management API on 2026-07-25: `pitr_enabled=false`,
`backups=[]`. (`walg_enabled` appears in the API response but is internal
infrastructure, not an operator-restorable backup.)

So the ONLY restorable copy of production is the local logical dump produced by
`scripts/backup-prod.sh`. Everything in this section describes that, not a
Dashboard feature.

| | Status |
|---|---|
| Managed daily backups | ✗ not on this plan |
| PITR | ✗ not on this plan |
| Local logical dump | ✓ `scripts/backup-prod.sh` |
| Scheduled daily 03:00 | ✓ launchd, **installed and verified 2026-07-27** |
| Off-site copy | ✗ **still manual — see below** |
| Storage (`kyc` bucket) | ✓ `scripts/backup-storage.sh` (needs a key stored) |
| Restore rehearsal | ✗ **never completed — see §2** |

### The scheduled backup

`scripts/com.sharmeats.backup.plist` runs `backup-prod.sh` daily at 03:00 and
reads the DB password from the macOS Keychain item `sharmeats-db-password`, so
no plaintext password sits in a file or in `ps` output.

```bash
cp scripts/com.sharmeats.backup.plist ~/Library/LaunchAgents/
launchctl load ~/Library/LaunchAgents/com.sharmeats.backup.plist
launchctl start com.sharmeats.backup     # run once now, don't wait for 03:00
launchctl list | grep sharmeats          # col 2 is the last exit status; 0 = OK
tail -20 ~/sharmeats-backups/backup.log
```

Verified end-to-end on 2026-07-27: the agent ran unattended, resolved the
Keychain password with no prompt, and wrote a complete backup (79 tables, 82
policies, 136 functions, 1.5 MB of rows) with exit status 0.

**This had never actually run before.** Commit `f8c91f9` added the plist to
`scripts/` and described it as scheduled, but nothing was ever copied into
`~/Library/LaunchAgents/`, so every backup until now was somebody typing the
command. Copying the file into the repo is not installing it.

The plist also used to pair `StartCalendarInterval` with `StartInterval=86400`,
commented as a catch-up for a sleeping Mac. That was backwards: `launchd.plist(5)`
says `StartCalendarInterval` is the key that survives sleep ("launchd will start
the job the next time the computer wakes up"), while `StartInterval` is the one
that misses firings, and the two "are not aware of each other". The pair produced
two independent schedules — 03:00 daily plus another every 24h from load time,
each a full dump of every customer row. `StartInterval` has been removed.

### Storage is NOT in the database dump

`pg_dump` captures the `storage.objects` metadata rows but not the file bytes,
which live in S3 behind the Storage API. Restoring `data.sql` alone recreates
rows pointing at objects that no longer exist — a dangling pointer that looks
like a successful restore.

```bash
security add-generic-password -a "$USER" -s 'sharmeats-service-role-key' -w 'KEY'
./scripts/backup-storage.sh
```

The `kyc` bucket is **private**, so this needs the service_role key, not the anon
key (the anon key returns an empty list, which reads as "no documents" rather
than as an error). As of 2026-07-27 the bucket contains **zero objects** — no
merchant has uploaded yet. Set this up now anyway: the moment onboarding starts,
KYC documents become the only asset in the system that cannot be reconstructed
from anything else. Orders and settlements can be recomputed; a passport scan has
to be collected again from a human.

### Still missing: the off-site copy

Every backup currently lives in `~/sharmeats-backups` on one laptop — the same
laptop that holds the Keychain password, the signing keys and the scheduler. A
backup that dies with the machine it protects is not a backup. Copy the newest
directory to an external drive or encrypted cloud storage, and treat the dumps as
production secrets: they contain every customer row, and `platform_settings`
carries the Telegram bot token inside `ops_alert_webhook_url`.

### Restore procedure

PITR is not available on this plan. Restoring means loading the dump into a new
database:

```bash
createdb -T template0 restored
psql -d restored -c 'create extension if not exists postgis'   # REQUIRED, see below
psql -d restored -f <stamp>/roles.sql
psql -d restored -f <stamp>/schema.sql
psql -d restored -c 'set session_replication_role = replica' -f <stamp>/data.sql
```

Two things that will bite you if you skip them:

- **PostGIS must exist first.** `addresses`, `drivers`, `hotels`, `kitchens` and
  `restaurants` all have `geography` columns. Without the extension those five
  `CREATE TABLE`s fail and roughly 180 downstream errors cascade from them,
  which looks like a corrupt dump but is not. Attempted on 2026-07-27 against a
  Homebrew Postgres 18.4 with no PostGIS: exactly that. `brew install postgis`
  fixes it.
- **`session_replication_role = replica` is required for the data step.** The
  dump has circular FKs (`users`↔`addresses`, `users`↔`payment_methods`), so
  loading with triggers and FK checks active fails partway.
- Expected and harmless: `spatial_ref_sys` data is absent — it is
  PostGIS-extension-owned and `CREATE EXTENSION postgis` regenerates it.
- **Migrations directory is the schema source of truth.** After any restore,
  confirm the applied schema matches `supabase/migrations/` (highest-numbered
  file — currently `138`; note the ledger itself is NOT reconciled, see
  DATABASE-RELEASE-RUNBOOK.md, so compare objects rather than trusting
  `supabase_migrations.schema_migrations`).

### Fixing a single bad row

Do not restore the whole database for one mistake. Load the newest dump into a
scratch database as above, `pg_dump` just the affected table out of it, and
reconcile the specific rows into prod by hand.

---

## 2. Disaster-recovery drills

A backup you have never restored is a hope, not a plan.

**Blocked as of 2026-07-27: the first drill has never completed.** The attempt
failed on a missing PostGIS extension locally, not on anything wrong with the
dump. One command unblocks it:

```bash
brew install postgis        # matches the Homebrew postgresql@18 already installed
```

Then, **once per quarter**:
1. Restore the latest dump into a throwaway database (see the restore procedure
   above — PostGIS first, then `session_replication_role = replica` for data).
2. Run 4 smoke checks:
   - a recent order exists;
   - `place_order` has exactly ONE overload (`select count(*) from pg_proc where
     proname='place_order'`) — two means PGRST202 on every call;
   - RLS is enabled on `orders` / `order_financials` / `kyc_documents`;
   - row counts match the manifest for the largest few tables.
3. Drop the database. Record the date + result below.

Until a drill passes, the backups are an untested assumption. They are known to
be *complete* (verified by object counts) but not known to be *restorable*.

Last drill: _(none yet — blocked on `brew install postgis`, see above.)_

---

## 3. Incident response — "something is wrong in prod"

Triage in this order. Most incidents are one of these.

### 3.1 Checkout is failing
- **Symptom:** customers can't place orders; app shows a generic error.
- **First check:** does `place_order` have exactly ONE overload, and does its arg
  set match what the app sends (12 args incl. dropoff)?
  ```sql
  select count(*), string_agg(pg_get_function_identity_arguments(oid), ' | ')
  from pg_proc where proname='place_order' and pronamespace='public'::regnamespace;
  ```
  (This exact drift — 10 args in prod vs 12 in the app — caused a full outage
  once; see the `sharmeats-promises-audit` memory. Any count ≠ 1 is the bug.)
- **Fix:** re-apply the latest `place_order` migration; drop stale overloads.

### 3.2 Drivers not getting new-order pushes / referral pushes silent
- **Check:** are the push callers sending the internal secret?
  ```sql
  select proname, position('push_headers' in pg_get_functiondef(oid)) > 0 as ok
  from pg_proc where proname in ('auto_assign_order','reward_referrer_on_delivery','issue_credit');
  ```
  All should be `ok = true`. A `create or replace` that restated an old body can
  silently drop the header → `expo-push` 401s every call (this regressed twice).
- **Confirm at the edge:** recent `net._http_response` rows for `/expo-push` —
  a run of `401 unauthorized` = header missing; `503 not configured` = the
  `push_internal_secret` Vault secret is unset.

### 3.3 Payments not marking paid
- `paymob-webhook` is the ONLY path a card order becomes `paid`. Check the
  function logs (Dashboard → Edge Functions → paymob-webhook → Logs). Common:
  `amount mismatch` (order total changed after intent), `invalid hmac`
  (`PAYMOB_HMAC_SECRET` wrong/rotated), `not configured` (secret unset).

### 3.4 Dispatch stuck / orders not assigned
- The `sharmeats-dispatch-watchdog` cron computes stuck-order counts every 2 min
  but only ALERTS if `ops_alert_webhook_url` is set (see §5). Manual check:
  ```sql
  select count(*) from orders
  where status in ('accepted','preparing','ready') and assigned_driver_id is null
    and placed_at < now() - interval '10 minutes';
  ```

### 3.5 General health
- Dashboard → **Logs** (Postgres + Edge). `get_advisors('security')` and
  `('performance')` surface RLS gaps and slow queries.

---

## 4. Rate limiting & abuse posture

### Public edge functions (`--no-verify-jwt`)
Neither has request-count rate limiting; each relies on a **cryptographic gate**
that makes floods useless rather than harmful:
- **`paymob-webhook`** — HMAC-SHA512 gated. A forged/replayed call fails the
  signature (401) or the amount assertion (400) before any DB write. A flood
  wastes function invocations but cannot mark anything paid.
- **`expo-push`** — gated by the `x-internal-secret` header (fails closed with
  401/503 when the secret is set). Only our own DB functions call it.

### Recommended hardening (owner, when traffic warrants)
- **Supabase provides platform-level rate limiting** on the API gateway and auth
  endpoints (Dashboard → Auth → Rate Limits: OTP sends, sign-ins, token refresh).
  **Verify OTP-send and sign-up limits are set** — these are the real abuse
  surface (SMS cost + account-farming), and they're configured in-dashboard, not
  in code.
- For the public functions, add a Cloudflare (or the registrar's) WAF rule in
  front of the Supabase functions domain if you see invocation-cost abuse. Not
  needed at launch volume; note it here so it's not forgotten.
- **COD fraud** is capped in `place_order` (active-COD + new-user-24h caps,
  serialized per-user by an advisory lock — mig 082). Tune the caps via
  `platform_settings` keys `cod_max_active_orders_per_user` /
  `cod_max_orders_new_user_24h`.

---

## 5. Alerting — turn on the watchdog

The `dispatch_watchdog` cron is a no-op until you give it a webhook:
```sql
update public.platform_settings
set value = to_jsonb('https://hooks.slack.com/services/XXX'::text)  -- Slack/Discord/etc.
where key = 'ops_alert_webhook_url';
```
Without this, stuck-dispatch and failed-sweep conditions are computed but **not
sent anywhere** — you'd only find out by running the §3.4 query manually. Set it.

As of 2026-07-27 both `ops_alert_webhook_url` and `ops_alert_telegram_chat_id`
**are** set in production.

### 5.1 Prove the alert path works (without waiting for an incident)

An alert channel that has only ever been exercised by real incidents is
indistinguishable from a broken one until the night it matters. Fire a
deliberate test:

```sql
select public.admin_test_ops_alert();
```

Call it as a **signed-in admin** (from the admin dashboard's SQL surface or an
authenticated client — not the anon key, which is refused). It returns the exact
message it sent.

Expected: a Telegram message beginning `[TEST]` arrives within seconds,
carrying the environment, a UTC timestamp and the database name.

Properties worth knowing:

| | |
|---|---|
| Authorization | admin only; fails closed (`AUTH_REQUIRED` / `NOT_AUTHORIZED`, SQLSTATE 23514) |
| Caller-supplied text | **none** — it takes no arguments, so it cannot be used to push arbitrary content through the ops channel |
| Writes | none to order/finance state; only its own rate-limit timestamp |
| Rate limit | one call per minute platform-wide (`RATE_LIMITED`) so it cannot flood the channel and get the bot throttled by Telegram — which would suppress *real* alerts |

**Acknowledge it** the same way as a real alert, then note the date here. And
because the `[TEST]` prefix is applied server-side and cannot be overridden,
**exclude `[TEST]`-prefixed alerts from incident counts and MTTR metrics** — a
test that looks like an incident corrupts the incident record.

| Date | Operator | Received? | Acknowledged? |
|---|---|---|---|
| _(pending — owner runs this from an admin session)_ | | | |

### 5.2 Is the channel itself alive? (two checks, deliberately separate)

§5.1 is a *manual* test. Between runs of it, the failure mode is total and
silent: `ops_alert` used to `perform net.http_post(...)`, discarding the request
id, so Telegram answering 401 was indistinguishable from success. Every watchdog
kept firing, every alert vanished, and **the platform looked quieter than
usual** — which reads like good news.

Two checks now run continuously, from opposite sides. Neither replaces the other.

| Check | Where | Validates | Tells you |
|---|---|---|---|
| `check_ops_alert_deliveries()` | pg_cron, every 5 min (mig 211) | the token **in the database** | which sends failed, and their text |
| `telegram-heartbeat` | GitHub Actions, 06:00 UTC daily | the token **in the repo secret** | that Telegram + the ops chat answer at all |

**Did an alert actually arrive?** `ops_alert_deliveries` is also an
outbox-of-record — with the channel completely dead the alert text still
survives, so nothing is lost, only delayed:

```sql
select created_at, ok, status_code, detail, left(alert_text, 100)
  from public.ops_alert_deliveries
 where ok is not true order by created_at desc limit 20;
```

`ok = true` is success. `ok = false` is a definite failure. **`ok is null` with
`checked_at` set means the pg_net response was pruned before the checker looked —
unknown, not success.** pg_net prunes within hours (measured 2026-08-01: 214 rows
retained, oldest ~5h), which is why the cron runs every 5 minutes.

**The gap between the two checks.** Nothing compares the database's token to the
repo secret's. A rotation that updates BotFather and GitHub but not
`platform_settings` leaves the heartbeat green while production is deaf. The tell
is in the chat: the daily heartbeat keeps arriving while every other alert stops.
A chat where the heartbeat is the only thing that ever appears is not a quiet
week. Rotation order is documented at the top of
`.github/workflows/telegram-heartbeat.yml` — change all three together, then
prove the database side with §5.1.

**Why nothing alerts about alert failures.** There is one channel; a broken
channel cannot carry news of itself. That is exactly why the heartbeat lives
outside the database and reports via GitHub's failure email instead.

---

## 6. Crash reporting (apps)

All three mobile apps have Sentry wiring **with DSNs configured since
2026-07-22** (org `beynd-mngmt`, one project per app — live from the next EAS
build after that date). Still dark: **admin-web and merchant-web** have the
wiring but no DSN — and because they are static exports, the env var must be
set **before `build:export`** or the shipped bundle is permanently blind.
Sourcemap upload also remains gated on `SENTRY_AUTH_TOKEN`.
- For the web apps: create the Sentry project, set the DSN env, rebuild, redeploy.
- Set `EXPO_PUBLIC_SENTRY_DSN` in each app's **EAS `production` profile** (or as
  an EAS secret) and rebuild.
- Customer app additionally supports `EXPO_PUBLIC_POSTHOG_API_KEY` for product
  analytics (same opt-in pattern).

---

## 7. Secret inventory (what must be set, and where)

| Secret | Where | Guards |
|---|---|---|
| `PAYMOB_HMAC_SECRET` | Supabase function secrets | webhook signature |
| `PUSH_INTERNAL_SECRET` | Vault + function secrets | expo-push caller auth |
| `SUPABASE_SERVICE_ROLE_KEY` | function env (auto) | privileged DB writes |
| `EXPO_PUBLIC_SENTRY_DSN` | EAS production profile (×3 apps) | crash reporting |
| `ops_alert_webhook_url` | `platform_settings` row | dispatch alerting |

Rotating any of these: update the store, then redeploy the function / rebuild the
app that reads it. A mismatched `PUSH_INTERNAL_SECRET` between Vault and the
`expo-push` function silently 401s every push — rotate both together.

## 8. Bulk catalog import — write rows in a consistent order

Bulk catalog writes (grocery/pharmacy onboarding, price-list refreshes, the CSV
importer) must order their statements **deterministically** — sort by
`restaurant_id`, then `menu_items.id` — and every importer must use the *same*
order.

**Why.** Two concurrent transactions that touch the same rows in *opposite*
order deadlock. This is ordinary Postgres row-lock contention, not specific to
any trigger. Reproduced on a clone (2026-07-29):

```
T1: update item A ... then item B
T2: update item B ... then item A
ERROR:  deadlock detected
```

Measured, so the diagnosis is not guesswork:

| scenario | result |
|---|---|
| opposing order, Rx items (capability trigger fires) | deadlock |
| opposing order, **plain `price_egp` update, trigger never fires** | **deadlock** |
| same order, 3 concurrent runs | **0 deadlocks** |

The middle row is the one that matters: the deadlock reproduces with the
capability trigger completely uninvolved, so it is a property of the write
pattern, not of `menu_items_enforce_vertical_capability()`. A trigger-side
"fix" would have been treating a symptom — an early draft (migration 167) tried
reordering the trigger's locks, did not help, and was discarded because it
also introduced a retry error on writes that previously succeeded. It was never
applied to production.

**What to do in an importer:**

1. `ORDER BY restaurant_id, id` before writing. One consistent order across all
   importers is the entire fix.
2. Prefer one statement over a loop — a single `UPDATE ... WHERE id = ANY($1)`
   with a sorted array takes its row locks in one pass.
3. Keep transactions short. The longer a batch holds locks, the wider the window.
4. Retry on SQLSTATE `40P01` (`deadlock_detected`) with backoff. Even correct
   code can lose a race against an unrelated writer (a merchant editing a price
   in the dashboard), and a deadlock victim is safe to retry — Postgres has
   already rolled it back.

Note `requires_prescription` writes additionally take the merchant row and the
vertical advisory lock (migration 160), so a *pharmacy* import holds locks
slightly longer than a food one. Ordering still fixes it; the extra locks do
not change the rule.

## 9. Push transport — outbox, retries and receipts

**Deployed 2026-07-30.** `expo-push` v17 and `expo-push-receipts` v1, both with
`--no-verify-jwt` (they authenticate with the `x-internal-secret` header instead and
fail CLOSED if `PUSH_INTERNAL_SECRET` is unset).

### What each moving part does

| Piece | Where | Runs |
|---|---|---|
| `expo-push` | edge function | called by 14 DB senders on every notification (`ops_alert` is NOT one — it targets Telegram/Slack, has no token or ticket, and is not a push) |
| `expo-push-receipts` | edge function | cron `sharmeats-push-receipts`, every 15 min |
| `claim_push_retries` / `settle_push_attempt` | mig 173 | retry claim + backoff |
| `expired_cart_sweep` | mig 170 | cron `sharmeats-expired-cart-sweep`, 04:30 |

### Reading the tables

To list the senders, match the URL exactly — a `like '%/expo-push%'` also catches
`push_receipt_sweep`, because `/expo-push-receipts` contains `/expo-push` as a
substring, and reports 15:

```sql
select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
   and pg_get_functiondef(p.oid) like '%''/expo-push''%'   -- quoted literal, not a prefix
 order by 1;
```

```sql
-- Did anything fail to reach Expo?
select status, suppression_reason, count(*)
  from public.push_messages group by 1,2 order by 3 desc;

-- Attempts stuck retrying, and what killed the dead ones
select status, error_code, count(*)
  from public.push_attempts group by 1,2 order by 3 desc;
```

`ATTEMPT_CAP` in `push_attempts.error_code` IS the dead-letter queue: five tries were
made, the last error is on the row, and it will never be retried.

### Vocabulary — this matters when reading a dashboard

* `expo_accepted` — Expo took the message from us.
* `provider_accepted` — APNs/FCM took it from Expo.
* **Neither means a device displayed it, and neither means a human saw it.** Nothing
  in this system knows that, so no column is called "delivered" and no report should
  say it either.
* `expired` — we never found out. An unknown, NOT a failure; counting it as one
  overstates the failure rate.

### Rollback

Both functions are versioned, so a bad deploy rolls back by redeploying the previous
commit:

```bash
git checkout <previous-sha> -- supabase/functions/expo-push
supabase functions deploy expo-push --no-verify-jwt --project-ref ilqpsebcfbaoaogimhud
git checkout HEAD -- supabase/functions/expo-push
```

`--no-verify-jwt` is NOT optional on either function. Deploying without it makes every
DB sender fail with 401, because they authenticate by header rather than JWT.

### Alerting

The receipt poller raises an `ops_alert` only for PROJECT-WIDE failures
(`InvalidCredentials`, `MismatchSenderId`, `ExperienceNotFound`) — never per dead
token. One `DeviceNotRegistered` is routine; paging on it is how the channel gets
muted and the credential failure that stops every push goes unnoticed.
