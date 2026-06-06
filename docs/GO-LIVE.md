# Sharm Eats — Go-Live Checklist

Single source of truth for what's done and what's left. Verified 2026-06-05.
Code is 100% complete across all surfaces. The remaining items are mostly
**external** (accounts, Apple review, your device) — not code.

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
Logins: dashboards `beyondtech.eg@gmail.com / SharmEats2026!`; driver test
`ahmed.driver@sharmeats.test / Driver#Test2026`.

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
3. ☐ **Deploy 3 edge functions** (currently 404 — written but not deployed):
   ```bash
   cd /Users/etch/Projects/apps/sharmeats
   supabase login   # one-time
   supabase functions deploy paymob-create-intention --project-ref ilqpsebcfbaoaogimhud
   supabase functions deploy paymob-webhook --no-verify-jwt --project-ref ilqpsebcfbaoaogimhud
   supabase functions deploy expo-push --no-verify-jwt --project-ref ilqpsebcfbaoaogimhud
   ```
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

## 🧹 Housekeeping (not blocking)
- ☐ **Rotate the Hostinger API token** that was pasted in chat (revoke in hPanel → Account → API, generate fresh).
- ☐ Delete the 3 unused Vercel projects (landing/merchant/admin) — nothing points to them.
- ☐ Verify a real dashboard login in the browser (sign in at merchant.sharmeats.online, confirm live orders load).
- ☐ Improve the privacy policy / add a dedicated app privacy URL if Apple wants more.

---

## TL;DR
- **Closed pilot (COD + TestFlight):** ready now.
- **Public launch (card payments + App Store):** blocked on Paymob setup (A) and the two App Store submissions (B, C) — all external/yours; the code is done.
