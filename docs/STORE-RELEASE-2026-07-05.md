# iOS App Store release — customer + driver (2026-07-05)

Ship this session's updates to the two apps that are already live. **Restaurant is
held** (its 1.0 is mid-review — don't disturb it; ship it after that clears).

## Live ASC state (verified via ASC API this session)
| App | ASC now | Ship as | Why |
|-----|---------|---------|-----|
| customer | 1.0.1 + 1.0 READY_FOR_SALE (live) | **1.0.3** | already set in app.json; > live 1.0.1 ✅ |
| driver | 1.0.1 + 1.0 READY_FOR_SALE (live) | **1.0.2** | bumped this session (was 1.0.0, which Apple would reject as ≤ live) |
| restaurant | 1.0 WAITING_FOR_REVIEW | — | **HOLD** — ship after 1.0 review clears |

Build numbers auto-increment remotely (`appVersionSource: remote`, `autoIncrement:
true`) — EAS will pick customer→41+, driver→14+. **Do not hand-set `ios.buildNumber`.**

What ships: customer = delight pass (PR #43) + N2/N8/N9/N10/N11 fixes + OTA config
(52 files since the last build). driver = phase-aware countdown + realtime offer
sync + unread badges (8 files).

## Pre-flight (verified 2026-07-05 — no config changes needed)
- **EAS build quota is available** — the July 1–3 cloud builds all *finished*; the
  "100% credits" note was from an earlier month. Cloud is viable.
- **Prior build failures are resolved:** customer's June Sentry failure is guarded
  by `SENTRY_DISABLE_AUTO_UPLOAD=true` (present in customer eas.json prod env);
  driver has no Sentry plugin so it never runs that step. Driver's July-1
  push-entitlement failure was a stale provisioning profile — EAS regenerated it,
  and driver build #13 (Jul 3) finished with push working. `expo-notifications`
  injects `aps-environment` at prebuild for both apps; do **not** hand-add it to
  `ios.entitlements` (would conflict with the plugin).

---

## Build + submit — PRIMARY PATH: cloud, non-interactive, auto-submit

Cloud build runs on EAS's macOS image (`macos-sequoia-15.6-xcode-26.2`, already in
`build.production.ios`), signs server-side with the certs already on EAS, and
`--auto-submit` chains the ASC upload the moment each build finishes — so this is
**fully hands-off** once you kick it off. No local CocoaPods, no Apple 2FA prompt.

```bash
cd /Users/etch/Downloads/sharmeats && git checkout main && git pull

# CUSTOMER 1.0.3 — build on EAS, auto-submit to App Store Connect when done
cd apps/customer
eas build --profile production --platform ios --non-interactive --auto-submit

# DRIVER 1.0.2
cd ../driver
eas build --profile production --platform ios --non-interactive --auto-submit
```

Each build takes ~20–40 min on EAS; you can run both back-to-back (they queue).
Watch progress at the URL each command prints, or `eas build:list`. The submit
profiles already carry the ASC API key (`AuthKey_C4TFQQ5AAD.p8`, key `C4TFQQ5AAD`)
and the right `ascAppId`, so `--auto-submit` needs nothing further.

### Fallback: local build (only if cloud quota unexpectedly blocks)
System `pod` (`/usr/local/bin/pod`) is **broken** (Ruby 2.6 stack trace); the
Homebrew one (`/opt/homebrew/bin/pod` 1.16.2) works — put brew first on PATH:
```bash
export PATH="/opt/homebrew/bin:$PATH"; export LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8
pod --version   # must print 1.16.2, NOT a stack trace
cd apps/customer && eas build --profile production --platform ios --local
eas submit --profile production --platform ios --path build-*.ipa
```
Local iOS builds prompt for Apple signing (interactive) — that's why cloud is
preferred.

---

## Auto-release (your choice) — set in ASC, NOT in eas.json

`eas submit` uploads the build; it does **not** set the release phase. To
auto-release after approval, in **App Store Connect → each app → the new version**:
- Set **"Automatically release this version"** (or Phased Release if you want a
  gradual rollout), then **"Submit for Review"** with the build attached.

Alternatively leave it Manual and click **Release** yourself once approved.
(You chose auto-release — so pick "Automatically release this version" on the
customer 1.0.3 and driver 1.0.2 version pages.)

Each app also needs, on that version page: **"What's New" release notes**, and the
build selected. Screenshots already exist from prior releases (reused unless the UI
changed materially — the delight pass changed customer visuals, so refresh customer
screenshots if App Review flags them).

---

## After it's live
- **OTA (customer only):** once a 1.0.3 install exists, future JS-only changes ship
  via `eas update --branch production` (runtimeVersion `appVersion` = 1.0.3). See
  docs/OTA-DELIVER.md.
- **Restaurant:** after its 1.0 clears review, bump to ≥1.0.1, build, submit.
- Backend is ready: prod DB at migration 094, expo-push v11 live.

## State
Merged to `main` (PR #61). `main` now has customer **1.0.3** and driver **1.0.2** —
`git checkout main && git pull`, then build. No branch juggling.
