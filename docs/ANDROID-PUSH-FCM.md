# Android push (FCM) setup

**Status as of 2026-07-31: Android push does not work in any of the three apps.**
Nothing here has been done yet. This document is the procedure, not a record.

## The symptom

Sentry, from a production customer build:

```
Default FirebaseApp is not initialized in this process eg.sharmeats.customer.
Make sure to call FirebaseApp.initializeApp(Context) first.
  _construct(index.android)
```

iOS push works — APNs credentials are managed by EAS from the Apple account and
were set up with the iOS build. Android was never configured. `expo-notifications`
cannot obtain a token, so those devices never register, and every push aimed at
them is dropped before it leaves the phone's own SDK.

## Why two separate artifacts are needed

This is the part that trips people up: **`google-services.json` alone is not
enough**, and neither is the service account. They do different jobs at opposite
ends of the pipeline.

| Artifact | Where it goes | What it enables |
|---|---|---|
| `google-services.json` | Build time, into the app binary | The app can talk to FCM at all and obtain a device token |
| FCM **V1 service account** JSON | EAS project credentials | Expo's servers may send to FCM *on your behalf* |

Push here goes out through Expo's service (`supabase/functions/expo-push` posts
to `https://exp.host/--/api/v2/push/send`). Expo relays to FCM, and FCM will only
accept a relay authenticated with your service account. So:

- Missing `google-services.json` → no token, device never registers.
- Missing service account → tokens exist, sends are rejected at the relay.

Both must be in place, for **each of the three apps** — they are separate Firebase
Android apps with separate package names and separate EAS projects.

| App | Package |
|---|---|
| customer | `eg.sharmeats.customer` |
| driver | `eg.sharmeats.driver` |
| restaurant | `eg.sharmeats.restaurant` |

Driver matters most operationally: a driver who never receives `new_offer` cannot
accept an order, and the dispatch sweep will cycle the offer to the next driver
(see migration 201, which now also requires a recent ping).

## Procedure

### 1. Firebase console — one project, three Android apps

<https://console.firebase.google.com>

Create a project (or reuse an existing one). Then **Add app → Android**, three
times, once per package name in the table above. Nothing else about the Firebase
project matters: no Firestore, no Analytics, no hosting. FCM is the only service
in use.

Download the generated `google-services.json` for each. They are different files
— do not reuse one across apps.

### 2. Upload each `google-services.json` to EAS as a file variable

**Easiest path — one command that does steps 2 and validates everything first:**

```bash
scripts/setup-android-fcm.sh \
  --customer   ~/Downloads/customer-google-services.json \
  --driver     ~/Downloads/driver-google-services.json \
  --restaurant ~/Downloads/restaurant-google-services.json \
  --service-account ~/Downloads/service-account.json
```

It refuses to upload anything until all four files check out: that each
`google-services.json` really contains the package it is being uploaded for
(three near-identical downloads are easy to mix up, and a swap produces no error
anywhere — just a device that silently never receives), that all four come from
the *same* Firebase project (mixing them is the classic `MismatchSenderId`, which
only shows up in a push receipt long after shipping), and that the service
account is one. Validation runs before the first upload, so you never end up with
two apps configured and one not — which is worse than none, because the two that
work make it look finished.

<details>
<summary>Or do it by hand</summary>

Run from inside each app directory, because EAS environment variables are
per-project:

```bash
cd apps/customer
eas env:set --environment production \
  --name GOOGLE_SERVICES_JSON \
  --type file \
  --value ./path/to/customer-google-services.json \
  --visibility sensitive
```

Repeat for `apps/driver` and `apps/restaurant` with their own files.

`--type file` is required. EAS stores the contents, materialises the file on the
build worker, and sets `GOOGLE_SERVICES_JSON` to its **path** — which is exactly
what `app.config.js` in each app expects.

</details>

> Do not commit these files. `.gitignore` blocks `google-services.json`
> repo-wide. This repository is public; Google does not treat the file as a
> secret, but it carries the project number and an API key and there is no
> upside to publishing them.

### 3. Upload the FCM V1 service account to EAS credentials

In the Firebase console: **Project settings → Service accounts → Generate new
private key**. This produces a different JSON from step 1 — it is a genuine
secret and grants send rights.

```bash
cd apps/customer
eas credentials --platform android
# → production → "Google Service Account" → "Manage your Google Service Account Key
#   for Push Notifications (FCM V1)" → upload the JSON
```

Repeat per app. One Firebase project can serve all three, so the *same* service
account JSON may be uploaded to all three EAS projects — unlike step 1, where the
files genuinely differ.

### 4. Rebuild

Android push is native configuration. **An OTA cannot deliver it** — the FCM
client has to be compiled in. Every Android build made before step 2 has no push,
permanently, no matter what is uploaded afterwards.

```bash
# GitHub → Actions → "EAS build" → Run workflow → app: <app>, platform: android
```

## How the repo side is wired

Each Expo app has an `app.config.js` that reads `app.json` and adds
`android.googleServicesFile` **only when `GOOGLE_SERVICES_JSON` is set**:

```js
if (googleServicesFile) {
  expo.android = { ...expo.android, googleServicesFile };
}
```

The condition is not defensive habit, it is load-bearing. Pointing
`googleServicesFile` at a path that does not exist **fails the Android build
outright**, so an unconditional setting would have broken every Android build
between the config landing and the upload happening. With the guard, the resolved
config is byte-identical to what `app.json` produced alone until the variable
exists — verified by diffing `expo config --type public` before and after — and
push begins working on the next build after upload with no further code change.

Nothing else needs editing. `app.json` stays the source of truth for static
config.

## Verifying it actually worked

Do not trust "the build succeeded". Push has a long history of failing silently
at each hop, which is why `supabase/functions/expo-push-receipts` exists at all.

1. Install the new Android build and sign in. A token row should appear for that
   user — the app registers on launch (`apps/customer/src/lib/push.ts`).
2. Trigger a real event (place an order → `driver_assigned`).
3. Check `push_messages` for the row, then the receipts function's output. A
   **ticket** means Expo accepted it from us. A **receipt** means FCM accepted it
   from Expo. Neither proves display — only the handset does that.
4. `DeviceNotRegistered` in a receipt means step 2 or 4 is incomplete for that
   app; `MismatchSenderId` means the `google-services.json` in the binary belongs
   to a different Firebase project than the service account.

## What is deliberately not automated

Steps 1 and 3 need Firebase console access and handle a real secret, so they are
manual by design. Everything the repository can own — the conditional config, the
gitignore protection, this document — is in place and needs no further work.
