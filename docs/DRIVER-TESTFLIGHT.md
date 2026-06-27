# Distribute the Driver app via TestFlight

The driver app (**Sharm Eats Driver**, ASC app id **6777379638**) is already live
on the App Store (Egypt only). Because it's been submitted to Apple, its build is
**already available in TestFlight** — you don't need to build or submit anything.
TestFlight is the right channel for a courier app: it **ignores App Store region
restrictions** (so testers anywhere can install it), and it's invite-only, which
matches "approved drivers only."

## Why TestFlight instead of the public store, for drivers

- **No region wall** — the public listing is Egypt-only; TestFlight installs work
  from any country (solves "not available in your country").
- **Invite-only** — you add drivers by email or share a public link; only invited
  people get it. Appropriate for a B2B courier tool.
- **Instant for internal testers** — no Apple review needed for the Internal
  Testing group (up to 100 testers from your team).
- **You can test it yourself** from any region without changing your Apple ID
  country.

## Setup — App Store Connect (≈5 min, your clicks)

1. Go to **App Store Connect → Apps → Sharm Eats Driver**:
   https://appstoreconnect.apple.com/apps/6777379638/testflight/ios
2. Open the **TestFlight** tab. You should see the existing build (v1.0,
   build 5/22-era) listed under **iOS builds**.
   - If it asks for **export compliance**, answer it (the app uses standard
     HTTPS only → usually "No" to proprietary encryption; the build already sets
     `ITSAppUsesNonExemptEncryption=false`).
3. **Internal Testing** (fastest, no review):
   - Click **Internal Testing → +** to create a group (e.g. "Drivers").
   - Add testers by Apple ID email (must be users on your App Store Connect team,
     up to 100). Add **your own** Apple ID first so you can test from any region.
   - Assign the build to the group → testers get an email invite.
4. **External Testing** (for real drivers who aren't on your ASC team):
   - Click **External Testing → +** to create a group (e.g. "Sharm Drivers").
   - Add testers by email **or** enable a **Public Link** — share that link with
     any driver; they install via the TestFlight app. Up to 10,000 testers.
   - The **first** external build needs a quick Apple "Beta App Review" (usually
     <24h); after that, new builds go out immediately.

## How a driver installs it

1. Install **TestFlight** (free, from the App Store — available in all regions).
2. Open your invite email or the public link → tap **Accept / Install**.
3. The driver app installs through TestFlight, region-independent.

## When you ship a NEW driver build (e.g. the hotel-handoff card)

The driver app got one improvement this session (hotel handoff card in the job
screen) that isn't in the live build yet. To ship it to TestFlight later:

```bash
cd apps/driver
# needs the ASC API key at ../customer/credentials/AuthKey_C4TFQQ5AAD.p8
eas build --platform ios --profile production
eas submit --platform ios --profile production --latest   # lands in TestFlight automatically
```

(Heads-up: iOS builds may hit the EAS Free-plan monthly quota — same as the
customer app. The existing TestFlight build works regardless; a new build is only
needed to ship the handoff improvement.)

## Notes

- The driver app's store availability stays **Egypt-only** — that's correct for
  couriers. TestFlight is your distribution channel; the public listing is
  essentially just a placeholder.
- Driver accounts are required to use the app (it's gated to approved drivers via
  the `drivers` table). TestFlight access ≠ app access — a tester still needs a
  driver account provisioned in Supabase.
