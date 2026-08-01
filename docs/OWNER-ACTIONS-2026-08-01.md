# Owner Actions — 2026-08-01

Everything fixable in code has been fixed, tested, applied to production, and
deployed. What remains needs **your machine, your secrets, or a store console** —
things I cannot and should not do for you. Ordered by urgency.

---

## 1. 🔴 P0 — Production backups are dead (3+ days stale)

**Diagnosed live:** the installed LaunchAgent
`~/Library/LaunchAgents/com.sharmeats.backup.plist` still points at the OLD repo
path `/Users/etch/Downloads/sharmeats/scripts/backup-prod.sh` (no `-new`).
`launchctl list` shows `- 78 com.sharmeats.backup` — exit 78 = EX_CONFIG,
program not found. Newest backup is `~/sharmeats-backups/20260729T000009Z`, i.e.
**2026-07-29** vs the 26 h freshness limit. Production has had **no backup for
3+ days**. The repo copy of the plist already has the correct new path.

**Fix (run on your Mac):**
```bash
cp /Users/etch/Downloads/sharmeats-new/scripts/com.sharmeats.backup.plist ~/Library/LaunchAgents/
launchctl unload ~/Library/LaunchAgents/com.sharmeats.backup.plist 2>/dev/null
launchctl load   ~/Library/LaunchAgents/com.sharmeats.backup.plist
launchctl start  com.sharmeats.backup
# confirm a fresh dir appears within a minute or two:
ls -dt ~/sharmeats-backups/*/ | head -1
```

**Then close the gap that hid it:** `scripts/check-backup-freshness.sh` exists
but is wired to nothing. Add a second daily LaunchAgent that, on non-zero exit,
POSTs to the ops Telegram webhook — the laptop-local check is the only one that
can see the laptop-local backup. (Longer term: move backups off the laptop
entirely — a laptop is not a backup host.)

---

## 2. 🔴 Rotate leaked credentials + enrol admin 2FA (still open from the first audit)

These are the biggest standing risk and none of tonight's work changed them:

- **Rotate the leaked admin & driver passwords** (commit `d3427a6`, public repo
  for 8 weeks). The server-side 2FA gate (mig 202 F-01) makes a stolen password
  insufficient *only once a factor is enrolled* — it does not un-leak it.
- **Enrol TOTP on both admin accounts** — `admin@sharmeats.online` and
  `hesham@beyondmngmt.ae`. I verified neither has a verified factor, so the
  server-side gate is currently **inert** for both. Enrol at
  `admin.sharmeats.online/security`. (Read the lockout warning in
  `docs/GO-LIVE.md` first — an MFA lockout is worse than a password one.)
- ~~**Rotate the Telegram bot token + webhook secret**~~ — **owner reports this
  done (2026-08-01)** and confirms alerts are still arriving, which is the
  meaningful test. Closed on that basis.

  Recorded for the next auditor, because it is the kind of thing that looks
  settled and is not: I could not verify it myself. The values I read in
  `platform_settings` afterwards were byte-identical to the pre-rotation ones
  (same `bot85…` prefix, same `9b9b2299…` secret), and I lost database access
  before I could re-check. Either I read a stale snapshot, or the rotation
  landed in BotFather without landing in the database. **Arriving alerts rule
  out the dangerous half** — a database holding a revoked token would be
  completely silent — so this is closed, but if alerts ever stop abruptly,
  start here. The good news that made this safe to close: the token was never
  in git history, so the exposure was the world-readable `platform_settings`
  row that mig 209 closed, not a permanent public leak.
- **Enable leaked-password protection (HaveIBeenPwned)** in the Supabase
  dashboard → Auth → Password settings. One toggle; the advisor still flags it.

---

## 3. 🟠 P1 — Sentry is a no-op on both web dashboards

`NEXT_PUBLIC_SENTRY_DSN` was unset at build time, so the deployed
merchant-web/admin-web bundles resolve it to `undefined` — **zero error
reporting on the dashboards**.

**Still true — re-verified against production 2026-08-01**, after the day's
merges, by fetching every JS chunk each surface references and grepping it:

| Surface | Chunks with a Sentry ingest URL | Chunks with the Supabase URL |
|---|---|---|
| `admin.sharmeats.online` | **0 of 14** | 3 |
| `merchant.sharmeats.online` | **0 of 14** | 2 |

The second column is the control, and it is what makes this conclusive rather
than suggestive: `NEXT_PUBLIC_SUPABASE_URL` *is* inlined by the same mechanism
in the same build, so inlining works and the DSN var was simply absent. This is
not a Sentry misconfiguration to debug — nothing is being sent at all.

**Read the consequence carefully: an empty Sentry for these two surfaces is not
a clean bill of health.** Zero dashboard errors means zero dashboard reporting.
It is the same shape as the silent Telegram channel and the dead backup job —
quiet that reads like good news. Any triage that says "no new web errors" is
describing the instrument, not the platform.

I could not fix this myself: the mobile apps have per-surface DSNs in their
`eas.json`, but **the two web dashboards need their own Sentry-project DSNs**,
which only exist in your Sentry org. Using a mobile DSN would misattribute
errors, so this is yours:

1. In the Sentry org, get (or create) the DSN for the `admin-web` and
   `merchant-web` projects.
2. Set `NEXT_PUBLIC_SENTRY_DSN=<dsn>` in the build env for each, then tell me and
   I'll rebuild + redeploy both to Hostinger (or you can run the same
   `STATIC_EXPORT=1 npm run build` + deploy I've been using).
3. Verify with the same check used above — a per-chunk grep, not a homepage
   grep, since the DSN lands in a chunk and not in the HTML:

```bash
for c in $(curl -fsS https://admin.sharmeats.online/ \
           | grep -oE '/_next/static/[^"]+\.js' | sort -u); do
  curl -fsS "https://admin.sharmeats.online$c" | grep -oE 'ingest\.[a-z.]*sentry\.io'
done | sort -u    # expect at least one hit; empty means still dark
```

---

## 4. 🟠 P1 — Telegram alert channel is single-point, unverified

Every watchdog (dispatch, churn, site-health, FX, receipts) funnels through one
fire-and-forget `net.http_post` in `ops_alert` whose response is discarded and
whose errors are swallowed. If that one channel dies, **every alert goes silent
and nothing notices.**

Both halves of the fix are now built:

- **Delivery check — done, applied to prod** (migration 211). `ops_alert` keeps
  the pg_net request id, and a 5-minute cron resolves each send against
  `net._http_response` into `public.ops_alert_deliveries`. The table doubles as
  an outbox-of-record: with the channel completely dead, the alert **text** still
  survives, so nothing is lost, only delayed.
- **Out-of-band heartbeat — done, needs one secret from you**
  (`.github/workflows/telegram-heartbeat.yml`). Pings Telegram daily at 06:00 UTC
  from GitHub Actions and fails the run if the channel does not answer. The alarm
  travels over GitHub's failure email, **not** over Telegram — a channel cannot
  carry the news that it is down.

**Your one action:**

```bash
gh secret set TELEGRAM_BOT_TOKEN      # the bot token, no "bot" prefix
gh secret set TELEGRAM_OPS_CHAT_ID    # the numeric chat id ops_alert posts to
```

Until both are set the workflow **fails on purpose** rather than skipping — an
unconfigured dead-man's switch that quietly passes is worse than none, because it
manufactures the confidence it exists to prevent.

### The gap neither half closes

The heartbeat validates the token **in the repo secret**; migration 211 validates
the token **in the database**. Nothing compares the two. A rotation that updates
BotFather and GitHub but not `platform_settings` leaves the workflow green while
production is deaf.

The tell is visible in the chat: the daily heartbeat keeps arriving while every
other alert stops. **A chat where the heartbeat is the only thing that ever
appears is not a quiet week.** After any rotation, prove the database side
separately — `ok = true` is the only acceptable answer, and `ok is null` means the
response was pruned before the checker looked, which is *not* a success:

```sql
select public.ops_alert('[sharmeats] post-rotation test');
-- wait ~30s (the checker deliberately skips sends younger than 20s), then:
select created_at, ok, status_code, detail
  from public.ops_alert_deliveries order by id desc limit 3;
```

---

## 5. 📱 Store distribution — submit the new builds

The corrected 1.1.0 builds are FINISHED on EAS but need submission from your
machine (`eas submit` reads your App Store Connect API key at
`apps/customer/credentials/AuthKey_*.p8`, which lives only where you created it):

```bash
cd apps/driver     && eas submit -p ios --latest      # driver iOS 28 — MOST important (idle heartbeat)
cd apps/restaurant && eas submit -p ios --latest      # restaurant iOS 10
cd apps/customer   && eas submit -p android --latest  # customer Android 35 → Play
```

The driver OTAs (COD fix, live job screen, offer double-tap guard) already reach
build 28 on next launch once it's installed.

---

## Everything already done (no action needed)

- **7 production migrations** applied + verified (204 commission backfill, 205
  promo release/remainder, 206 dispatch tuning + ping bridge, 207 deletion-PII
  completeness, 208 push-retry contract) — all with isolated-Postgres tests and
  post-apply assertions; advisors clean, ledger invariant exact.
- **COD delivery regression** (our own mig 202 broke every cash delivery) —
  fixed + urgent OTA.
- **6 client fixes** shipped OTA/deploy: driver live job screen, offer double-tap
  guard, customer order-not-found/error states, checkout partial-failure routing,
  admin CSV formula-injection.
- **The 5 audit dimensions that never ran** — completed with adversarial
  verification; every confirmed P0/P1 above or fixed.
- **Ping bridge**: `dispatch_max_ping_age_seconds` raised 300 → 1800 so idle
  drivers stay dispatchable until build 28 lands. **Revert to 300** once the
  fleet is updated.
