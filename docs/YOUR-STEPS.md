# Sharm Eats — Your remaining steps (the parts only you can do)

_Last updated: 2026-07-13._ All code, migrations, config, and build prep are **done and on `main`**.
Everything below is blocked on **accounts, billing, credentials, external approval, or a
physical device** — things an assistant cannot provide. Each is reduced to exact commands/clicks.

Current state:
- **Prod DB** at migration **108** (all applied + verified live).
- **App versions** on `main`: customer **1.0.4**, driver **1.0.3**, restaurant **1.0.1** (Expo SDK 52 / RN 0.76.9).
- **Card payments** are behind a flag (`EXPO_PUBLIC_PAYMENTS_CARD_ENABLED=false`) — COD-only is live.
- **Submit profiles** (iOS ASC + Android Play) are wired in all 3 `eas.json`.
- **0 open PRs.** Working tree clean.

---

## 0. Trigger the next production build ⏳ (BLOCKED on EAS billing)

All 3 apps need a **native rebuild** (Sentry config-plugin + metro changes from PRs #75/#76 are
not OTA-able) and the versions are already bumped. The build is fully prepped — it just failed on
the **EAS Free-plan monthly credit cap**, which resets **Aug 1, 2026**.

Pick one:
- **Wait for Aug 1**, then run the builds below.
- **Upgrade the EAS plan** → <https://expo.dev/accounts/etchmuzik/settings/billing> → build now.
- **Build locally (free)** on this Mac — run from each app dir:
  ```bash
  cd apps/customer   && eas build --platform android --profile production --local
  cd ../driver       && eas build --platform android --profile production --local
  cd ../restaurant   && eas build --platform android --profile production --local
  # iOS local builds may prompt for Apple signing:
  cd ../customer     && eas build --platform ios --profile production --local
  ```
- **Or, once credits are back, cloud-build all 6** (build numbers auto-increment remotely):
  ```bash
  for app in customer driver restaurant; do
    (cd apps/$app && eas build --platform android --profile production --non-interactive --no-wait)
    (cd apps/$app && eas build --platform ios     --profile production --non-interactive --no-wait)
  done
  eas build:list   # verify each — `--platform all` masks partial failures
  ```

---

## 1. Turn on Sentry crash reporting + readable stack traces

The apps ship Sentry **wired but dark** (no DSN → silent no-op). Source-map upload is fully wired
too (PR #76) and fires when the auth token is present.

1. Create Sentry project(s) at <https://sentry.io> (one per app or shared).
2. **Runtime DSN** (turns on crash capture):
   - **Mobile** — per app: `cd apps/<app> && eas secret:create --scope project --name EXPO_PUBLIC_SENTRY_DSN --value "<dsn>" --type string`
   - **Web** — set `NEXT_PUBLIC_SENTRY_DSN` in the merchant/admin build env (Vercel/Hostinger).
3. **Source-map upload** (readable traces) — set the auth token:
   - **Mobile** — per app EAS secret: `SENTRY_AUTH_TOKEN` (org/project slugs `sharmeats` / `sharmeats-<app>` are already in each `eas.json`; edit if yours differ).
   - **Web** — set `SENTRY_AUTH_TOKEN` / `SENTRY_ORG` / `SENTRY_PROJECT` in the build env, `npm install` in `apps/merchant-web` + `apps/admin-web`, and build with `npm run build:export`.
4. Rebuild (§0). Token-less builds still succeed — a red-looking `error: sentry-cli` log line on mobile is non-fatal.

---

## 2. Close the spatial_ref_sys write hole (owner-gated SQL)

Mig 102 documented but could NOT apply this (the grant was made by `supabase_admin`; the migration
role can't revoke it). Run these two lines in the **Supabase Dashboard SQL editor** (which runs with
enough privilege):
```sql
revoke insert, update, delete, truncate on public.spatial_ref_sys from anon;
revoke insert, update, delete, truncate on public.spatial_ref_sys from authenticated;
```
MEDIUM severity (availability/integrity of geo math; no PII/money).

---

## 3. Card payments (Paymob) — when ready

COD ships fine without this. The refund path (PR #75, `paymob-refund` edge fn) is **built but not
deployed** — deploy it together with enabling card.

1. Paymob Egypt merchant account + KYC (<https://paymob.com>); enable an online-card integration → note its **Integration ID**.
2. Collect 4 keys: secret (`sk_…`), public (`pk_…`), integration ID, HMAC secret.
3. Deploy the edge functions (one-time `supabase login`):
   ```bash
   supabase functions deploy paymob-create-intention --project-ref ilqpsebcfbaoaogimhud
   supabase functions deploy paymob-webhook --no-verify-jwt --project-ref ilqpsebcfbaoaogimhud
   supabase functions deploy paymob-refund   --project-ref ilqpsebcfbaoaogimhud   # NEW (refunds)
   supabase functions deploy expo-push --no-verify-jwt --project-ref ilqpsebcfbaoaogimhud
   ```
4. Set secrets:
   ```bash
   supabase secrets set PAYMOB_SECRET_KEY="sk_…" PAYMOB_PUBLIC_KEY="pk_…" \
     PAYMOB_INTEGRATION_ID="123456" PAYMOB_HMAC_SECRET="…" \
     --project-ref ilqpsebcfbaoaogimhud
   ```
5. Point Paymob callbacks (transaction + response) at:
   `https://ilqpsebcfbaoaogimhud.supabase.co/functions/v1/paymob-webhook`
6. Flip the flag `apps/customer/eas.json` → `EXPO_PUBLIC_PAYMENTS_CARD_ENABLED` `"false"→"true"`, then rebuild the customer app (§0).
7. Test with a Paymob test card → order flips to `paid`; test a refund from the admin support flow → order flips to `refunded`.

---

## 4. Store submission

Submit profiles are wired for all 3 apps (`eas submit --profile production` per app).

**iOS** — after §0 produces builds: `cd apps/<app> && eas submit -p ios --profile production --latest`.
Each app record must exist in App Store Connect; bump `expo.version` before re-submitting a version
that's already in review (done for this round: 1.0.4/1.0.3/1.0.1).

**Android** — new Google Play accounts must run a **14-day closed test with ≥12 testers** before the
production track unlocks. Ships to `internal` track now (`releaseStatus: draft`); promote later.
Driver Play listing still needs a **feature graphic** (no `store-assets` dir yet).

---

## 5. Long-lead legal / business (start ASAP — months of runway)

Not code — but they gate lawful operation at scale:
- **Register an Egyptian entity** (S.A.E./LLC) + tax card, **disclosed in-app**; sector licensing for food delivery + couriers.
- **VAT registration + ETA e-invoicing** integration (the data model is ready and dark at `commission_vat_pct=0`; flip once registered).
- **Bank/Instapay payout rail** — the schema records what's owed to restaurants + drivers (PRs #74/#75); the actual transfer execution needs a provider account.
- **Restaurant/driver contractor agreements.**

---

## 6. Observability / ops (console actions)

- **Ops alert webhook** — `platform_settings.ops_alert_webhook_url` is empty, so the dispatch
  watchdog pages no one. Paste a Slack/Discord webhook via Dashboard SQL:
  `update public.platform_settings set value = to_jsonb('<webhook-url>'::text) where key='ops_alert_webhook_url';`
- **CI** — GitHub Actions is billing-blocked (runs `startup_failure` in ~2s). Enable Actions billing
  (or move to an org) so the workflow actually gates merges.

---

## 7. Housekeeping (low priority)

- **Rotate any API token pasted in chat** (Hostinger, etc.).
- **Universal links** — enable Associated Domains on the customer App ID + re-add
  `"associatedDomains": ["applinks:sharmeats.online"]` to `apps/customer/app.json` (AASA is already
  live at sharmeats.online). Enables campaign deep links opening the app.
- **Untracked scratch docs** in `docs/` (`AUDIT-LEAN.md`, `FINAL-BOSS*.md`, `FULL-STACK-*.md`,
  `OTA-DELIVER.md`) are old audit/prompt notes — delete if you don't want them.
