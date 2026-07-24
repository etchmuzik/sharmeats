# Ship the PR #43 delight pass over-the-air (customer app)

> **⚠️ OVERTAKEN BY EVENTS (2026-07-24):** the delight pass shipped inside the
> v1.0.3 store binaries built July 15, so this runbook's premise no longer
> applies. Kept because the `runtimeVersion` mechanics below remain correct and
> non-obvious. Current release sequencing: `docs/DATABASE-RELEASE-RUNBOOK.md`.

Config read from `apps/customer/app.json` + `eas.json` (2026-07-05):
EAS project `d3628b78-b35a-4d15-a48a-c12b9579b682` · owner `etchmuzik` · slug `sharmeats-customer`
· app **version 1.0.3** · `runtimeVersion.policy = appVersion` · production build → **channel
`production`** · `appVersionSource: remote`.

## ⚠️ The one thing that decides whether this works: runtimeVersion
`runtimeVersion` is `appVersion`, so this OTA update is stamped **1.0.3** and will ONLY be
delivered to installed builds whose runtimeVersion is also **1.0.3**. An install on 1.0.0–1.0.2
will silently NOT receive it.

- **If the build already in TestFlight / Play internal (and on testers' phones) is 1.0.3** →
  the OTA reaches them. Proceed below.
- **If the field build is older (≤1.0.2)** → OTA won't land. You must **build + submit 1.0.3
  first** (`eas build --profile production …` → submit), get it onto devices, then this OTA (and
  every future JS-only change on 1.0.3) flows over the air.

Check what's out there first:
```
cd apps/customer
eas whoami            # log in as etchmuzik if needed: eas login
eas build:list --limit 5        # note the version/runtimeVersion of the latest production build
```
The delight pass is JS + assets only (animations, Sunny image, celebration, copy, tab icons,
onboarding, empty states) → OTA-eligible. (If it had added a native module, you'd need a rebuild,
not an OTA.)

## Publish the update
```
cd apps/customer
eas update --branch production \
  --message "PR #43 delight pass: press animations + haptics, Sunny mascot, order-placed celebration, active-weight tabs, offline onboarding, empty states, 5-locale copy"
```
If the `production` channel isn't linked to a branch yet (first-ever update), link it once:
```
eas channel:edit production --branch production
```

## Verify it went out
```
eas update:list --branch production     # see the new update, platforms, runtimeVersion 1.0.3
eas channel:view production             # confirm channel → branch → this update
```
On a 1.0.3 device: cold-start the app twice (expo-updates fetches on launch and applies on the
next start).

## Roll back if it misbehaves
```
eas update:rollback --branch production   # reverts the channel to the previous good update
```
(or republish the prior update). Because it's OTA, rollback is instant — no store review.

## Notes
- Only the **customer** app was configured here; if the driver/restaurant apps also got delight
  changes, repeat per app (each has its own `app.json` + EAS projectId + channel).
- `EXPO_PUBLIC_PAYMENTS_CARD_ENABLED=false` in the production profile → **card checkout is off by
  design (COD-only launch)**, which is why `paymob-create-intention` isn't deployed (audit F2 =
  intentional, not a defect).
- I can't run `eas` for you (needs your EAS login); run the blocks above from `apps/customer`.
