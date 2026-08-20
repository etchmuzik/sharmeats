# Sharm Eats — Go-Live Checklist

Single source of truth for what's done and what's left. Verified 2026-07-30
against the live project and the deployed site — not from memory; re-verified
2026-08-20 during the go-live pass (ASC API, prod DB, live version manifests —
see "2026-08-20 go-live pass" below). The remaining items are mostly
**external** (accounts, Apple review, your device) — not code.

Re-verify before trusting this file. The 2026-06-05 pass went stale in ways
that were invisible from the outside: it reported three edge functions as 404
when five were live, and the landing site ran ~8 weeks behind `main` because
the build script prints an upload instruction rather than uploading.

---

## 🚀 LAUNCHING NOW: cash-only via TestFlight (Paymob later)

Decision (2026-06-06): go live **cash-on-delivery only**; add card (Paymob) later.

- **Card payment is hidden** behind `EXPO_PUBLIC_PAYMENTS_CARD_ENABLED=false`
  (commit `6330143`) — card + Apple Pay don't appear, so no order can hit the
  undeployed Paymob path. COD + local wallets remain. Re-enable: flip the flag
  to `true` in `apps/customer/eas.json` (+ `.env`) and rebuild.
- **Customer 1.1.0 (build 60) is in internal TestFlight testing** — uploaded
  2026-08-15, `internalBuildState=IN_BETA_TESTING` per the ASC API 2026-08-20.
  (This file previously tracked "build #11"; the 1.0.0 train is history — the
  App Store resubmission in section B should attach build 60.) Still does
  **not** carry universal links — `ios.associatedDomains` remains absent from
  `app.json`. See LAUNCH-RUNBOOK §1.4.
- **Driver 1.1.0 (build 29) is in internal TestFlight testing too** — same
  dates, same evidence. The old blockers are gone: the ASC app record exists
  and its id `6777379638` is in `apps/driver/eas.json`. Remaining: ☐ **YOU**
  add the actual drivers as TestFlight testers (they are not in the internal
  group by magic), and get them to go online — all 4 seeded drivers last
  pinged 2026-07-29.
- **Web surfaces are live at current main** (redeployed 2026-08-20, see below);
  **backend live**; **COD pipeline verified end-to-end**.

Beware `eas build:list` claiming a build was never submitted: both builds above
showed "not submitted" on EAS while sitting in TestFlight. An `eas submit` that
fails with `EAS_UPLOAD_TO_ASC_VERSION_DUPLICATE` means the binary is ALREADY
uploaded — ask the ASC API (the repo's AuthKey_C4TFQQ5AAD.p8), not EAS, before
concluding a rebuild is needed.

### 2026-08-20 go-live pass (what changed that night)

- **Mig 216 (driver-GPS Realtime authorization) applied to prod** and properly
  ledgered. The "coordinated release" it was waiting for had, in fact, already
  happened: 1.1.0 clients (private channels) were in TestFlight since 08-15,
  so the missing policies were the broken half. Applied in a zero-traffic
  window; both policies verified in `pg_policies`.
- **Customer OTA published** (branch `production`, runtime 1.1.0, update group
  `72a12fcb`): ships commit `72efb7a`, which pins the storefront's restaurant
  reads to 25 explicit columns.
- **Mig 218 (payout-column revoke) is authored but NOT applied — deliberate.**
  Gate: any 1.1.0 binary still on pre-OTA JS calls `select('*')` on
  `restaurants`, and PostgREST fails the whole query once a column is revoked.
  Apply 218 only after the OTA has adoption (phones fetch it on second
  launch). Exposure meanwhile: `commission_pct` (12/15) — every `payout_*`
  value was NULL on 2026-08-20.
- **merchant-web + admin-web redeployed** at `d9a2e7d` (both had been ~3 weeks
  stale on Aug 1 builds; verified via `/version.json` after deploy — Hostinger
  deploys are async, "Request accepted" ≠ deployed, poll the manifest).
- The Hostinger **MCP plugin token 401s** (the rotated token was never put in
  the plugin config). Working path: `npx -y hostinger-api-mcp` over stdio with
  the shell `HOSTINGER_API_TOKEN`. Dashboard builds need
  `NEXT_PUBLIC_SUPABASE_URL` + `NEXT_PUBLIC_SUPABASE_ANON_KEY` set inline —
  neither app has a `.env.local`, and the /login prerender hard-fails without
  them.

**Operate cash-only:** customers order (COD) → merchant accepts on
merchant.sharmeats.online → admin dispatches on admin.sharmeats.online → driver
delivers + collects cash (the app's "Collect X EGP" confirm settles it).
Logins: dashboards sign in as `admin@sharmeats.online`; the driver test account
is in the Supabase dashboard. **Passwords are never written down here** — this
repo is public, so anything in it is published. Keep them in a password manager.

---

Detailed how-to lives in [LAUNCH-RUNBOOK.md](./LAUNCH-RUNBOOK.md);
App Review reply in
[../apps/customer/store-screenshots-clean/APP-REVIEW-NOTES.md](../apps/customer/store-screenshots-clean/APP-REVIEW-NOTES.md).

---

## ✅ DONE & verified live

| Item | Status |
|---|---|
| Landing site `sharmeats.online` | ✅ Live (Hostinger, valid SSL) |
| Merchant dashboard `merchant.sharmeats.online` | ✅ Live at `d9a2e7d` (redeployed 2026-08-20) |
| Admin dashboard `admin.sharmeats.online` | ✅ Live at `d9a2e7d` (redeployed 2026-08-20) |
| Supabase backend (schema + seed) | ✅ Live, restaurants load (44 active/open) |
| **COD order pipeline** (place → merchant → admin dispatch → driver → settle) | ✅ Verified live (place_order runs server-side; full flow validated) |
| Customer 1.1.0 build 60 | ✅ Internal TestFlight (IN_BETA_TESTING since 2026-08-15) |
| Driver 1.1.0 build 29 | ✅ Internal TestFlight (IN_BETA_TESTING since 2026-08-15) |
| Mig 216 — driver-GPS Realtime authorization | ✅ Prod-applied 2026-08-20 |
| Customer OTA `72a12fcb` (storefront column pinning) | ✅ Published 2026-08-20 |
| iOS location purpose string, GO_BACK fix, clean screenshots | ✅ Committed |
| Privacy pages (customer / driver / restaurant) | ✅ Live |
| Universal links | ⚠️ **Not enabled.** The AASA file ships, but `ios.associatedDomains` is absent from `apps/customer/app.json`, so iOS never fetches it — links open Safari. See LAUNCH-RUNBOOK §1.4. |
| Customer app impeccable design pass (icons, RTL, a11y) | ✅ Committed |

**A closed pilot (cash-on-delivery, TestFlight testers) is doable today.**

---

## ❌ REQUIRED for public launch

### A. Payments (Paymob) — the biggest gap. **Card orders can't complete until done.**
Owner: **you** (KYC + keys) → then a couple of commands.
1. ☐ Create a Paymob Egypt merchant account + complete KYC (multi-day). [Runbook §2.1]
2. ☐ Collect 4 keys: secret, public, integration ID, HMAC. [§2.2]
3. ☐ **Deploy `paymob-create-intention`** — the only Paymob function still
   missing. Checked against the project 2026-07-30: `paymob-webhook` (v5),
   `expo-push` (v17), `expo-push-receipts` (v1), `delete-account` (v4) and
   `telegram-bot` (v3) are all already **ACTIVE**, so the old "3 functions are
   404" note here was wrong.
   ```bash
   supabase login   # one-time
   supabase functions deploy paymob-create-intention --project-ref ilqpsebcfbaoaogimhud
   ```
   Also undeployed but **not blocking**, because nothing calls them:
   `paymob-refund` (no call sites) and `kyc-upload` (no call sites — KYC
   uploads go straight to storage under the migration 076 policies).
4. ☐ Set the 4 secrets (`supabase secrets set …`). [§2.4]
5. ☐ Point Paymob dashboard callbacks at the webhook URL. [§2.5]
6. ☐ Test with a Paymob test card → order flips to `paid`. [§2.6]

### B. Customer app → App Store (currently REJECTED, v1.0)
Owner: **you** (device recording) + App Store Connect web UI.
1. ☐ Record the order flow on a **physical iPhone** (install 1.1.0 build 60 from TestFlight). Apple requires a real device.
2. ☐ In App Store Connect (the rejected version is editable): bump the version string to 1.1.0, attach build 60, swap the 6.9"+6.5" clean screenshots from `apps/customer/store-screenshots-clean/`, paste the App Review notes, add phone `+971581232600`, re-uncheck "Sign-in required", **Submit for Review**. [APP-REVIEW-NOTES.md §D]

### C. Driver app → TestFlight — ✅ DONE (verified 2026-08-20)
1. ✅ ASC app record "Sharm Eats Driver" exists (Apple ID `6777379638`).
2. ✅ Its id is in `apps/driver/eas.json`; build 29 (1.1.0) is in internal
   TestFlight. Remaining: add the real drivers as testers (see LAUNCHING NOW).

---

## 🔴 Credential rotation — do these first

This repo is **public**. Until 2026-07-30 this file printed the dashboard login
in plaintext at the line above, so that password must be treated as burned:
redacting it does not undo the exposure, because git history keeps the old blob
and GitHub's forks, API and code-search may already hold copies.

- ✅ **`beyondtech.eg@gmail.com` demoted to `customer`** (verified in prod
      2026-08-20). The burned password no longer reaches dispatch, finance,
      commission or KYC. The admins are now `admin@sharmeats.online` (active)
      and `hesham@beyondmngmt.ae` (never signed in).
- ☐ **Review Supabase auth logs** for sign-ins to that account you do not
      recognise, going back to 2026-06-06 when the repo went public. (Still
      worth doing once — the exposure window predates the demotion.)
- ✅ **`ops@sharmeats.test` demoted to `customer`** (verified 2026-08-20) —
      no longer an admin, so the unreachable-mailbox problem is moot.
- ✅ **Hostinger API token rotated** — evidenced by the MCP plugin's stored
      token now returning 401. ☐ Put the fresh token in the plugin config too
      (the shell `HOSTINGER_API_TOKEN` has it; the plugin still has the corpse).

Rule going forward: no password, token or API key in this repo, in any file.
Mailbox addresses are fine; the secrets that open them are not.

### Two-factor (TOTP) — and how to recover from a lost authenticator

**Status 2026-08-20: still zero verified factors across both admin accounts.**
This is the last security gate that needs a human with an authenticator.

Enrol at **admin.sharmeats.online/security**. Once a factor is verified, signing
in asks for a six-digit code after the password.

**READ THIS BEFORE ENROLLING.** An MFA lockout is worse than a password lockout,
and the 2026-07-30 incident showed how fast a single-admin lockout escalates. A
forgotten password is recoverable by email; a lost authenticator device is **not
recoverable by any self-service path** — that is the entire point of a second
factor. A password reset does not help.

Recovery requires deleting the factor server-side. Either:

- Supabase dashboard → Authentication → Users → the account → remove the factor, or
- as the `postgres` role:
  ```sql
  delete from auth.mfa_factors
   where user_id = (select id from auth.users where email = 'admin@sharmeats.online');
  ```

Two things that make this much less likely to matter:

- **Use an authenticator that syncs across devices** (1Password, Authy, iCloud
  Keychain). A phone-only app means a lost phone is a lost account.
- **Keep the setup key** shown during enrolment somewhere safe — in the password
  manager, not in this repo. It regenerates the same codes on a new device.
- **Enrol a second admin** before relying on this. One admin with one factor is
  a single point of failure in both directions: lose it and nobody can dispatch,
  approve KYC, or reach finance.

## 🧹 Housekeeping (not blocking)
- ☐ Delete the 3 unused Vercel projects (landing/merchant/admin) — nothing points to them.
- ☐ Verify a real dashboard login in the browser (sign in at merchant.sharmeats.online, confirm live orders load).
- ☐ Improve the privacy policy / add a dedicated app privacy URL if Apple wants more.

---

## TL;DR
- **Closed pilot (COD + TestFlight): LIVE** — both 1.1.0 apps in internal
  TestFlight, backend + dashboards at current main (2026-08-20). Human steps
  left: add drivers as testers, get drivers online, enrol admin MFA.
- **Public launch (card payments + App Store):** blocked on Paymob setup (A)
  and the customer App Store resubmission (B) — external/yours; the code is
  done. C (driver TestFlight) is complete.
- **DB follow-up:** apply mig 218 once OTA `72a12fcb` has adoption.

---

## Payment mode: CASH-ON-DELIVERY ONLY (current launch state)

The customer app ships **cash-only** on purpose. Card/Apple Pay are hidden
everywhere — there is no dead "pay by card" button and no reachable card path.

- **Where it's controlled:** `apps/customer/src/lib/payments.ts` →
  `CARD_PAYMENTS_ENABLED` (reads `EXPO_PUBLIC_PAYMENTS_CARD_ENABLED`).
  Set to `"false"` in `apps/customer/eas.json` production profile.
- **Effect:** `listPaymentMethods()` returns COD only, so both the checkout
  summary and the payment picker show only Cash on Delivery. The checkout's
  card branch (`if (isCard)`) is unreachable while the flag is off.
- **COD works with zero card config** — verified live: 41/41 open restaurants
  accept cash, `mark_cod_collected` reconciles driver earnings, per-user COD
  fraud caps (3 active / 5 new-user-24h) are enforced race-safely.

### To enable card payments later (do NOT do this before Paymob is live)
1. Create the Paymob account; set `PAYMOB_SECRET_KEY` / `PAYMOB_PUBLIC_KEY` /
   `PAYMOB_INTEGRATION_ID` / `PAYMOB_HMAC_SECRET` as function secrets.
2. Deploy `paymob-create-intention` + `paymob-webhook` (`--no-verify-jwt` on the
   webhook) and set the callback URL in the Paymob dashboard.
3. Flip `EXPO_PUBLIC_PAYMENTS_CARD_ENABLED=true` in `eas.json` and **rebuild** the
   customer app. Card only appears in a fresh build — it is not a runtime toggle.

Flipping the flag on before steps 1–2 are done would show customers a card option
that can't complete. Keep it `false` until Paymob is verified end-to-end.
