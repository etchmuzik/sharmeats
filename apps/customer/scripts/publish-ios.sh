#!/usr/bin/env bash
#
# Publish the Sharm Eats customer iOS app — build + submit, NON-INTERACTIVELY,
# using the App Store Connect API key (no Apple ID 2FA prompts).
#
# Already wired (verified working):
#   - API key:    apps/customer/credentials/AuthKey_C4TFQQ5AAD.p8  (present)
#   - Key ID:     C4TFQQ5AAD          + Issuer: d19fd03e-…         (in eas.json)
#   - App icon, env, bundle id (eg.sharmeats.customer), buildNumber (ready)
#
# ── ONE PREREQUISITE you must do once in the App Store Connect WEB UI ──
# The ASC API forbids creating apps/bundle IDs (HTTP 403, Apple policy), so:
#   1. https://developer.apple.com/account/resources/identifiers → "+" →
#      App IDs → App → register bundle ID  eg.sharmeats.customer
#   2. https://appstoreconnect.apple.com/apps → "+" → New App →
#      Platform iOS, Name "Sharm Eats", primary language English,
#      pick the bundle ID from step 1, SKU sharmeats-customer-001
# Then this script runs the rest unattended.
#
# Usage (after the prerequisite):  ./scripts/publish-ios.sh
#
# What it does:
#   1. Connects EAS to the App Store Connect app (via the API key)
#   2. Exposes the ASC key to the BUILD so it mints the iOS Distribution
#      Certificate + provisioning profile non-interactively
#   3. Builds the production .ipa and auto-submits to TestFlight
#
# After it completes the build is in TestFlight; finishing "published" still
# needs you to add listing metadata + screenshots and submit for Apple review
# (1–3 days) — Apple-gated, not scriptable.

set -euo pipefail
cd "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

KEY_ID="C4TFQQ5AAD"
KEY_PATH="./credentials/AuthKey_${KEY_ID}.p8"
ISSUER="d19fd03e-1f5b-44b1-a3e9-519b25a39274"

bold() { printf "\033[1m%s\033[0m\n" "$1"; }
die()  { printf "  \033[31m✗ %s\033[0m\n" "$1"; exit 1; }
ok()   { printf "  \033[32m✓\033[0m %s\n" "$1"; }

bold "Sharm Eats — iOS publish (non-interactive, ASC API key)"
[ -f "$KEY_PATH" ] || die "API key missing: $KEY_PATH"
ok "API key present ($KEY_ID), issuer wired"

export EXPO_ASC_API_KEY_PATH="$KEY_PATH"
export EXPO_ASC_KEY_ID="$KEY_ID"
export EXPO_ASC_ISSUER_ID="$ISSUER"
export EAS_BUILD_NO_EXPO_GO_WARNING=true

echo
bold "1/3 Connecting EAS to App Store Connect app…"
# Needs the app to exist (created in the web UI — see header). EAS finds it by bundle id.
eas integrations:asc:connect --api-key-id "$KEY_ID" --bundle-id eg.sharmeats.customer \
  || die "ASC connect failed — has the 'Sharm Eats' app been created in App Store Connect yet? (see header)"
ok "connected to App Store Connect app"

echo
bold "2/3 + 3/3 Building production iOS binary and auto-submitting…"
eas build --platform ios --profile production --non-interactive --auto-submit

echo
ok "Build submitted to App Store Connect / TestFlight."
echo "  Final (Apple-gated, App Store Connect web UI):"
echo "    • Add listing metadata + screenshots (landing /screenshots, 1320×2868)"
echo "    • Submit for App Review → release when approved"
