# Sharm Eats — Your remaining steps (the parts only you can do)

Everything code/config/build/deploy is done. These three items are blocked on
**accounts, credentials, or a physical device** — things an assistant can't
provide. Each is reduced to copy-paste commands or exact clicks.

Status as of 2026-06-06: **cash-only is LIVE on TestFlight** (customer build #12
VALID; web + backend live; COD verified). These finish the rest.

---

## 1. Driver app → TestFlight  (fastest; unblocks the COD delivery loop)

Build #3 (with the design pass) is built and waiting. You only need to create
the App Store Connect record (the API key can't — Apple returns 403).

1. **Register the App ID** (if not already): <https://developer.apple.com/account/resources/identifiers>
   → + → App IDs → App → bundle `eg.sharmeats.driver`.
2. **Create the app record**: <https://appstoreconnect.apple.com/apps> → + → New App
   → iOS, Name **“Sharm Eats Driver”**, primary language English,
   bundle `eg.sharmeats.driver`, SKU `sharmeats-driver-001`.
   Copy the **Apple ID** (the numeric one) it shows.
3. **Paste it + submit** (replace the placeholder in `apps/driver/eas.json`):
   ```bash
   cd /Users/etch/Projects/apps/sharmeats/apps/driver
   # edit eas.json: "ascAppId": "REPLACE_WITH_DRIVER_ASC_APP_ID" → the numeric Apple ID
   eas submit -p ios --profile production --latest
   ```
4. App Store Connect → Sharm Eats Driver → TestFlight → add your drivers as testers.
   Driver test login: `ahmed.driver@sharmeats.test` / `Driver#Test2026`.

---

## 2. Paymob (card payments) — when you're ready to add card

Cash-only ships fine without this. Do it when the Paymob account is approved.

1. **Create a Paymob Egypt merchant account** + complete KYC: <https://paymob.com>
   (multi-day approval). Enable an **online-card** integration; note its
   **Integration ID**.
2. **Collect 4 keys** (Paymob dashboard → Settings → Account Info / Integrations):
   secret key (`sk_…`), public key (`pk_…`), integration ID, HMAC secret.
3. **Deploy the edge functions** (one-time `supabase login` first):
   ```bash
   cd /Users/etch/Projects/apps/sharmeats
   supabase login
   supabase functions deploy paymob-create-intention --project-ref ilqpsebcfbaoaogimhud
   supabase functions deploy paymob-webhook --no-verify-jwt --project-ref ilqpsebcfbaoaogimhud
   supabase functions deploy expo-push --no-verify-jwt --project-ref ilqpsebcfbaoaogimhud
   ```
4. **Set the secrets** (paste your real values):
   ```bash
   supabase secrets set PAYMOB_SECRET_KEY="sk_…" PAYMOB_PUBLIC_KEY="pk_…" \
     PAYMOB_INTEGRATION_ID="123456" PAYMOB_HMAC_SECRET="…" \
     --project-ref ilqpsebcfbaoaogimhud
   ```
5. **Point Paymob callbacks** (dashboard, both transaction + response) at:
   `https://ilqpsebcfbaoaogimhud.supabase.co/functions/v1/paymob-webhook`
6. **Turn card back on** in the app (it's hidden behind a flag right now):
   ```bash
   # apps/customer/eas.json → "EXPO_PUBLIC_PAYMENTS_CARD_ENABLED": "false" → "true"
   cd apps/customer && eas build -p ios --profile production --auto-submit
   ```
7. Test with a Paymob test card → confirm the order flips to `paid` in the
   `orders` table. (Full detail: LAUNCH-RUNBOOK.md §2.)

---

## 3. Public App Store (customer app) — when you want it publicly downloadable

The app is on TestFlight now; this makes it publicly searchable/installable.
Version 1.0 is in **Rejected** state (Apple's earlier info-request), so it edits
and resubmits in place.

1. **Record the order flow on a PHYSICAL iPhone** (Apple requires a real device,
   not the simulator — the .mov on the Desktop is a simulator capture and won't
   satisfy them). Install build #12 from TestFlight, screen-record: launch →
   Start as guest → browse → customize an item → cart → checkout (COD).
2. In **App Store Connect** → Apps → Sharm Eats → the **1.0** version:
   - Attach **build #12**.
   - Swap the marketing-poster screenshots for the clean set in both the 6.9"
     and 6.5" iPhone slots: `apps/customer/store-screenshots-clean/iphone69/`
     and `.../iphone65/` (drag them in).
   - Paste the **App Review Notes** (the full text is in
     `apps/customer/store-screenshots-clean/APP-REVIEW-NOTES.md`, section A).
   - Add the App Review phone number `+971581232600`.
   - Re-confirm **“Sign-in required” is unchecked** (guest-first; it re-checks
     itself on reopen).
   - **Submit for Review.**
3. (Note: since cash-only, the Notes' payment line is now accurate as-is — no
   card/IAP. When you later enable Paymob, no App Store change needed.)

---

## 4. Housekeeping (low priority)

- **Rotate the Hostinger API token** pasted in chat earlier (hPanel → Account →
  API → revoke, regenerate).
- **Delete the 3 unused Vercel projects** (landing/merchant/admin) — everything
  is on Hostinger now.
- **Universal links** (deep links open the app): enable the **Associated
  Domains** capability on the `eg.sharmeats.customer` App ID, re-add
  `"associatedDomains": ["applinks:sharmeats.online"]` to `apps/customer/app.json`
  (removed so build #12 could ship), regenerate the profile, rebuild. The AASA
  file is already live at sharmeats.online. Pure nice-to-have.
