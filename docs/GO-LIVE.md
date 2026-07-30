# Sharm Eats — Go-Live Checklist

Single source of truth for what's done and what's left. Verified 2026-07-30
against the live project and the deployed site — not from memory. The remaining
items are mostly **external** (accounts, Apple review, your device) — not code.

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
- **Customer build #11** triggered → TestFlight (auto-submit). Carries
  cash-only + location string + GO_BACK fix + fmt fix + full design pass +
  universal links. Real users can take COD orders via TestFlight once it lands.
- **Web surfaces are already live** (landing + both dashboards on Hostinger);
  **backend live**; **COD pipeline verified end-to-end**.

**Driver app → TestFlight (to dispatch the COD orders):** ☐ YOU
1. Create the ASC app record "Sharm Eats Driver" (bundle `eg.sharmeats.driver`)
   — App Store Connect web UI (the API key can't, 403). [LAUNCH-RUNBOOK §4.2]
2. Put its Apple ID in `apps/driver/eas.json` (`REPLACE_WITH_DRIVER_ASC_APP_ID`).
3. `cd apps/driver && eas build -p ios --profile production --auto-submit`
   (build #3 — carries the driver design pass; first build minted credentials).
4. Add drivers as TestFlight testers.

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
| Merchant dashboard `merchant.sharmeats.online` | ✅ Live (Hostinger, valid SSL) |
| Admin dashboard `admin.sharmeats.online` | ✅ Live (Hostinger, valid SSL) |
| Supabase backend (schema + seed) | ✅ Live, restaurants load |
| **COD order pipeline** (place → merchant → admin dispatch → driver → settle) | ✅ Verified live (place_order runs server-side; full flow validated) |
| Customer app code + build #10 | ✅ On TestFlight |
| Driver app code + build #2 (.ipa) | ✅ Built |
| iOS location purpose string, GO_BACK fix, clean screenshots | ✅ Committed |
| Universal links (AASA + app.json), privacy page | ✅ Committed (ship on next build) |
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
1. ☐ Record the order flow on a **physical iPhone** (install build #10 from TestFlight). Apple requires a real device.
2. ☐ In App Store Connect (v1.0 is editable — Rejected): attach build #10, swap the 6.9"+6.5" clean screenshots from `apps/customer/store-screenshots-clean/`, paste the App Review notes, add phone `+971581232600`, re-uncheck "Sign-in required", **Submit for Review**. [APP-REVIEW-NOTES.md §D]

### C. Driver app → TestFlight / App Store
Owner: **you** (2 web-UI steps).
1. ☐ Create the App Store Connect app record "Sharm Eats Driver" (bundle `eg.sharmeats.driver`). [LAUNCH-RUNBOOK §4.2]
2. ☐ Paste its Apple ID into `apps/driver/eas.json` (replace `REPLACE_WITH_DRIVER_ASC_APP_ID`), then `eas submit -p ios --profile production --latest`. [§4.3]

---

## 🔴 Credential rotation — do these first

This repo is **public**. Until 2026-07-30 this file printed the dashboard login
in plaintext at the line above, so that password must be treated as burned:
redacting it does not undo the exposure, because git history keeps the old blob
and GitHub's forks, API and code-search may already hold copies.

- ☐ **Rotate the `beyondtech.eg@gmail.com` password** — it is an `admin` role
      account reaching dispatch, finance, commission and KYC approval. Better
      still, retire it as the admin identity in favour of `admin@sharmeats.online`
      (a real mailbox, so it can receive a password reset; the gmail is personal).
- ☐ **Review Supabase auth logs** for sign-ins to that account you do not
      recognise, going back to 2026-06-06 when the repo went public.
- ☐ **Retire or repoint `ops@sharmeats.test`** — a second dormant `admin` account
      (last sign-in 2026-06-04). `.test` is a reserved TLD that can never receive
      mail, so it cannot be password-reset, only deleted or repointed.
- ☐ **Rotate the Hostinger API token** that was pasted in chat (revoke in
      hPanel → Account → API, generate fresh).

Rule going forward: no password, token or API key in this repo, in any file.
Mailbox addresses are fine; the secrets that open them are not.

### Two-factor (TOTP) — and how to recover from a lost authenticator

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
- **Closed pilot (COD + TestFlight):** ready now.
- **Public launch (card payments + App Store):** blocked on Paymob setup (A) and the two App Store submissions (B, C) — all external/yours; the code is done.

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
