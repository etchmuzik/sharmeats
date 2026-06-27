# Android Play Store upload — Sharm Eats 1.0

The production Android App Bundle (`.aab`) is built and ready. This ships the
FULL feature set to Android (RU/IT/DE + invite + hotel cards + auto-dispatch +
referrals — more than the iOS build 22 that's launching).

## The artifact

- **Download:** https://expo.dev/artifacts/eas/TYneXyLpzCBSdyCtePpqcOmZuJkymrqTNFxbQRvbYyY.aab
- **Package:** `eg.sharmeats.customer`
- **Version:** 1.0.0 (versionCode 2)
- **Format:** `.aab` (Android App Bundle — the format Play wants; do NOT convert to APK)

## Path A — Manual upload (fastest, no service account needed)

1. Download the `.aab` from the link above.
2. Go to **Google Play Console** → select **Sharm Eats**.
3. **Testing → Internal testing** (start here — safest) → **Create new release**.
   - Or **Production** if you want it public immediately (only after you've tested the internal build on a device).
4. **Upload** → drop the `.aab`.
5. **Release name:** `1.0.0 (2)`.
6. **Release notes** — paste from `docs/RELEASE-NOTES.md` (the `en (Play)` short
   block; Play allows 500 chars per language, and you can add the ar/ru/it/de
   short blocks too).
7. **Review release** → **Start rollout to Internal testing**.
8. Add testers (your email + team) under Internal testing → Testers, then open
   the opt-in link on an Android device to install and smoke-test.

## Path B — eas submit (for CI / repeatable releases)

Needs a **Google Play service account JSON** (one-time setup):
1. Google Play Console → **Setup → API access** → create/link a Google Cloud
   project → create a **service account** → grant it "Release apps to testing
   tracks" (or Admin) → download the JSON key.
2. Save it somewhere safe (NOT in the repo). Then:

```bash
cd apps/customer
eas submit --platform android --profile production --latest
# It will prompt for the service account JSON path the first time, then store it
# on EAS for future submits. eas.json already targets track=internal, status=draft.
```

## After it's on the internal track

- Smoke-test on a real Android device: place an order, switch language to
  Русский/Italiano/Deutsch, open the Invite screen, check a hotel order shows
  the handoff card.
- Promote Internal → Closed/Open testing → Production in Play Console when happy.

## First-time Play submission note

If this is the app's FIRST Play Store submission, Play also requires (one-time):
content rating questionnaire, target audience, data safety form, privacy policy
URL (you have `sharmeats.online/privacy`), and store listing assets. The Play
listing copy is in `docs/PLAY-STORE-LISTINGS.md`.
