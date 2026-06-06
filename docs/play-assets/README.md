# Google Play graphic assets

Generated 2026-06-06 for the Play Store listings (see ../PLAY-STORE-LISTINGS.md).

| File | Use | Size |
|------|-----|------|
| `feature-customer.png` | Sharm Eats (customer) — Play **feature graphic** | 1024×500 |
| `feature-driver.png` | Sharm Eats Driver — Play **feature graphic** | 1024×500 |

Customer phone screenshots reuse the iOS set:
`apps/customer/store-screenshots-clean/iphone69/`.

Source HTML for the feature graphics: regenerate with Chrome headless
`--screenshot --window-size=1024,500` from the templates if edits are needed.

## Driver phone screenshots — DEFERRED to submission time

Not yet captured. Needed only when submitting the driver app to Play (gated on
the $25 Google account; internal-testing track is lenient on screenshots anyway).

**Gotcha when you capture them:** the driver's `preview` EAS build profile does
NOT bake in the Supabase backend, so a preview APK shows a "Backend not
configured" guard screen instead of the real sign-in/jobs UI. Putting `env` in
`eas.json`'s `preview` profile is **overridden** by the (empty) EAS-hosted
`preview` *environment* (EAS Build resolves the named environment over the
profile's `env` block when `appVersionSource: remote`). To get real screens:

1. Set the vars on EAS for the environment you build:
   `cd apps/driver && eas env:create --environment preview --name EXPO_PUBLIC_SUPABASE_URL --value https://ilqpsebcfbaoaogimhud.supabase.co --visibility plaintext`
   (repeat for `EXPO_PUBLIC_SUPABASE_ANON_KEY`), **or** just build the
   `production` profile (which is wired) and capture from that.
2. Build, install on an emulator/device, sign in as the test driver
   (`ahmed.driver@sharmeats.test` / `Driver#Test2026`), and capture: sign-in,
   online/home, a job card, active delivery, collect-cash confirm (2–8 shots,
   1080×2400). Drop them in a `driver-screenshots/` folder here.
