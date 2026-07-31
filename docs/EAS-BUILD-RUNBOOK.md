# EAS build & submit runbook — customer app

Everything code-side is ready (`appVersionSource: remote`, so EAS
auto-increments the build number — do not hand-edit it).

## Fastest path: run the build from GitHub

**Actions → EAS build → Run workflow.** Pick the app (or `all`), the platform,
and the profile. Needs one repository secret, `EXPO_TOKEN` (expo.dev → Account
→ Access tokens); the workflow fails with a named error if it is missing rather
than hanging on a login prompt no runner can answer.

It **waits** for the build instead of firing and forgetting, so a red job means
a failed build. This repository is public, so Actions minutes are free and that
honesty costs nothing.

It does **not** submit — see §3 below. Submission needs the ASC `.p8` and the
Play service-account JSON, which are gitignored and not in this repository, so
that step still runs from a machine that has them.

The rest of this document is the manual path: use it when you want local
control, when the workflow is unavailable, or when submitting.

> **A JS-only fix still needs a full build right now.** All three apps use
> `runtimeVersion: {"policy": "appVersion"}` and sit at **1.1.0**, while the
> binaries on TestFlight were built at **1.0.0**. An `eas update` published
> today targets runtime 1.1.0, which no installed app is running — it would
> reach nobody. OTA becomes a real shortcut only once a 1.1.0 binary is out.

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

Production env comes from two places — `eas.json` build.production.env **and**
EAS-managed environment variables. Confirm all of these before building
(`eas env:list --environment production`):
- `EXPO_PUBLIC_SUPABASE_URL` = the prod project — *(in eas.json)*
- `EXPO_PUBLIC_USE_SUPABASE` = true — *(in eas.json)*
- `EXPO_PUBLIC_PAYMENTS_CARD_ENABLED` = **false** (cash-only until Paymob KYC is done — leave false for this release) — *(in eas.json)*
- `EXPO_PUBLIC_SUPABASE_ANON_KEY` = the prod project's anon/publishable key — **EAS-managed env var, NOT in eas.json.** This one is required: with `USE_SUPABASE=true` and the URL set but the anon key missing, the app throws on launch. Verified present in EAS production (June 2026).

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
