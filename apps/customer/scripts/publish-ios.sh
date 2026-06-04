#!/usr/bin/env bash
#
# Publish the Sharm Eats customer iOS app — build + submit, NON-INTERACTIVELY,
# using the App Store Connect API key (no Apple ID 2FA prompts).
#
# The ONLY thing this needs that isn't already on disk is your ASC API key
# Issuer ID (a UUID from App Store Connect → Users and Access → Integrations →
# Keys → "Issuer ID" at the top). Everything else is wired:
#   - API key:    apps/customer/credentials/AuthKey_C4TFQQ5AAD.p8  (present)
#   - Key ID:     C4TFQQ5AAD                                       (in eas.json)
#   - App icon, env, bundle id, buildNumber                        (ready)
#
# Usage:
#   export ASC_ISSUER_ID="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
#   ./scripts/publish-ios.sh
#
# What it does:
#   1. Writes the issuer id into eas.json's submit profile
#   2. Sets the ASC API key as EAS env vars so the BUILD can create the
#      iOS Distribution Certificate non-interactively (the step that fails
#      without credentials)
#   3. Builds the production .ipa
#   4. Submits it to App Store Connect / TestFlight
#
# After this completes, the build is in TestFlight; finishing "published"
# still requires you to add listing metadata + screenshots in App Store
# Connect and submit for Apple review (1–3 days) — Apple-gated, not scriptable.

set -euo pipefail
cd "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

KEY_ID="C4TFQQ5AAD"
KEY_PATH="./credentials/AuthKey_${KEY_ID}.p8"

bold() { printf "\033[1m%s\033[0m\n" "$1"; }
die()  { printf "  \033[31m✗ %s\033[0m\n" "$1"; exit 1; }
ok()   { printf "  \033[32m✓\033[0m %s\n" "$1"; }

bold "Sharm Eats — iOS publish (non-interactive, ASC API key)"

[ -f "$KEY_PATH" ] || die "API key missing: $KEY_PATH"
ok "API key present ($KEY_ID)"

ISSUER="${ASC_ISSUER_ID:-}"
[ -n "$ISSUER" ] || die "Set ASC_ISSUER_ID first (App Store Connect → Users and Access → Integrations → Keys → Issuer ID)."
ok "issuer id provided"

# 1. wire issuer into eas.json
node -e '
  const fs=require("fs");const p="eas.json";const j=JSON.parse(fs.readFileSync(p,"utf8"));
  j.submit=j.submit||{};j.submit.production=j.submit.production||{};
  j.submit.production.ios={ascApiKeyPath:process.env.KEY_PATH,ascApiKeyId:process.env.KEY_ID,ascApiKeyIssuerId:process.env.ISSUER};
  fs.writeFileSync(p,JSON.stringify(j,null,2)+"\n");
' KEY_PATH="$KEY_PATH" KEY_ID="$KEY_ID" ISSUER="$ISSUER"
ok "wired issuer into eas.json submit profile"

# 2. expose the ASC API key to the BUILD so it can create the distribution
#    certificate without interactive Apple login.
export EXPO_ASC_API_KEY_PATH="$KEY_PATH"
export EXPO_ASC_KEY_ID="$KEY_ID"
export EXPO_ASC_ISSUER_ID="$ISSUER"
export EXPO_APPLE_TEAM_ID="${EXPO_APPLE_TEAM_ID:-}" # optional; EAS infers from key
ok "ASC API key exported for build credential setup"

echo
bold "Building production iOS binary…"
eas build --platform ios --profile production --non-interactive --auto-submit

echo
ok "Build submitted to App Store Connect / TestFlight."
echo "  Next (Apple-gated, in App Store Connect web UI):"
echo "    • Add listing metadata + screenshots (see landing /screenshots, 1320×2868)"
echo "    • Submit for App Review → release when approved"
