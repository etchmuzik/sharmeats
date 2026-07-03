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

### What's in place
- Supabase takes **automatic daily backups** on paid plans. On the Pro plan,
  **Point-in-Time Recovery** can be enabled (Dashboard → Database → Backups) to
  restore to any second within the retention window (7 days default).

### Owner action (one-time) — **verify this is on**
1. Dashboard → **Database → Backups**. Confirm the plan includes daily backups.
2. **Enable PITR** if not already — it is the difference between "restore to
   yesterday" and "restore to 30 seconds before the bad `DELETE`."
3. Note the **retention window**. If it's 7 days, that's your recovery horizon.

### Extra safety: weekly logical export (recommended)
Automatic backups are only as good as the plan. For an owner-controlled copy that
survives a billing lapse or account issue, export weekly and store off-Supabase:
```bash
# Full schema + data dump (run from a machine with the DB password / connection string)
supabase db dump --db-url "$PROD_DB_URL" -f "sharmeats-$(date +%F).sql"
# Store the file somewhere OUTSIDE Supabase (S3, Google Drive, encrypted disk).
```

### Restore procedure
- **PITR (preferred):** Dashboard → Database → Backups → *Restore* → pick the
  timestamp just before the incident. This restores the **whole project** — it is
  disruptive, so use it for genuine data loss, not a single bad row.
- **Single-table / single-row mistakes:** do NOT PITR the whole DB. Instead:
  1. Restore a backup into a **separate branch/project**.
  2. `pg_dump` just the affected table from the restored copy.
  3. Reconcile the specific rows back into prod by hand.
- **Migrations directory is the schema source of truth.** After any restore,
  confirm `supabase_migrations.schema_migrations` matches `supabase/migrations/`
  (latest applied should be the highest-numbered file — currently `084`).

---

## 2. Disaster-recovery drills

A backup you have never restored is a hope, not a plan. **Once per quarter:**
1. Restore the latest backup into a throwaway branch.
2. Run 3 smoke queries: a recent order exists, `place_order` has exactly one
   overload, RLS is enabled on `orders`/`order_financials`/`kyc_documents`.
3. Delete the branch. Record the date + result.

Last drill: _(none yet — run the first one.)_

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

---

## 6. Crash reporting (apps)

All three apps have Sentry wiring; it is **opt-in via env and OFF until a DSN is
set**. A release build without it warns loudly in logs but ships blind.
- Create a Sentry project (one per app, or one with app tags).
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
