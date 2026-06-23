# EAS build & submit runbook — customer app

Everything code-side is ready (version bumped to **1.0.0**, `appVersionSource:
remote` so EAS auto-increments the build number). These steps need YOUR Expo +
Apple auth, so run them yourself. Copy-paste from here.

## What this build ships to users (currently only on `main`, not in any binary)

- 5 languages: English, العربية, Русский, Italiano, Deutsch
- Invite-a-friend referral screen (`/invite`)
- Hotel-handoff cards (customer tracking + driver job screen)
- All the polish merged in PR #9

> Server-side features (auto-dispatch, referral DB logic) are **already live** in
> Supabase — they don't need this build. This build is what delivers the
> **app/UI** changes to users.

## Prerequisites (one-time)

```bash
npm i -g eas-cli            # or: pnpm add -g eas-cli
cd apps/customer
eas login                   # your Expo account
eas whoami                  # confirm logged in
```

## 1. Sanity-check config

```bash
cd apps/customer
cat app.json | grep -A1 '"version"'        # should show "version": "1.0.0"
eas build:configure --platform all          # only if not already configured
```

`eas.json` production env is already set:
- `EXPO_PUBLIC_SUPABASE_URL` = the prod project
- `EXPO_PUBLIC_USE_SUPABASE` = true
- `EXPO_PUBLIC_PAYMENTS_CARD_ENABLED` = **false** (cash-only until Paymob KYC is done — leave false for this release)

## 2. Build

```bash
cd apps/customer

# iOS (App Store). appVersionSource:remote auto-bumps the build number.
eas build --platform ios --profile production

# Android (Play Store internal track, per eas.json submit config).
eas build --platform android --profile production

# Or both at once:
eas build --platform all --profile production
```

## 3. Submit

```bash
# iOS — uses the ascApiKey config already in eas.json (submit.production.ios).
eas submit --platform ios --profile production --latest

# Android — pushes to the 'internal' track as a draft (per eas.json).
eas submit --platform android --profile production --latest
```

## 4. After iOS submit lands in App Store Connect

- Attach the new build to the **1.0** version (or create the next version).
- Use the corrected screenshots from `apps/customer/store-screenshots/iphone69-ios-statusbar/`
  and `ipad13-ios-statusbar/` (already uploaded if you did the metadata resubmit).
- Paste the "What's New" copy from `docs/RELEASE-NOTES.md` (per-language).
- Submit for Review.

## Notes / gotchas

- **Version vs build number:** `version` (1.0.0) is the user-visible marketing
  version and lives in `app.json`. The **build number** is managed remotely by
  EAS (`appVersionSource: remote`) and auto-increments each build — you do NOT
  edit it by hand.
- **iPad:** the app is universal (`supportsTablet: true`), so the iOS build is
  one universal binary; the iPad screenshot set is required (already prepared).
- **Don't enable card payments in this build.** Keep
  `EXPO_PUBLIC_PAYMENTS_CARD_ENABLED=false` until the Paymob edge functions are
  deployed and KYC is complete (see below). Shipping it true with no deployed
  `paymob-create-intention` function would break checkout for card users.

## Still gated on you (not part of this build)

- **Paymob card payments:** `paymob-create-intention` + `paymob-webhook` are in
  the repo but NOT deployed to prod (verified via Supabase edge-functions list).
  Deploy needs your Paymob KYC keys:
  `supabase functions deploy paymob-create-intention` /
  `supabase functions deploy paymob-webhook --no-verify-jwt`, then
  `supabase secrets set PAYMOB_SECRET_KEY=… PAYMOB_PUBLIC_KEY=… PAYMOB_INTEGRATION_ID=… PAYMOB_HMAC_SECRET=…`,
  then flip `EXPO_PUBLIC_PAYMENTS_CARD_ENABLED=true` and rebuild.
