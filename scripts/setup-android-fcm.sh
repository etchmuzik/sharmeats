#!/usr/bin/env bash
#
# Upload the Android FCM artifacts to EAS, with the checks that catch the
# mistakes people actually make.
#
# Run this AFTER the Firebase console steps in docs/ANDROID-PUSH-FCM.md, from
# a machine logged into EAS (`eas login`). It cannot be run from CI or from an
# agent session: `eas credentials` is interactive by design, and the files it
# handles are secrets that should not pass through a workflow input.
#
# WHAT IT VALIDATES, AND WHY EACH CHECK EXISTS:
#
#   1. Each google-services.json actually contains the package it is being
#      uploaded for. Three near-identical files downloaded in one sitting are
#      trivially easy to swap, and a swap produces no error at upload, no error
#      at build, and no error at send — just a device that never receives
#      anything, discovered whenever someone finally notices.
#
#   2. All four files belong to the SAME Firebase project. Mixing a
#      google-services.json from one project with a service account from
#      another is the classic cause of MismatchSenderId, which surfaces only in
#      a push receipt long after the build shipped.
#
#   3. The service account really is one (type: service_account with a private
#      key), not the google-services.json pasted twice.
#
# Usage:
#   scripts/setup-android-fcm.sh \
#     --customer   path/to/customer-google-services.json \
#     --driver     path/to/driver-google-services.json \
#     --restaurant path/to/restaurant-google-services.json \
#     --service-account path/to/service-account.json

set -euo pipefail

CUSTOMER="" DRIVER="" RESTAURANT="" SERVICE_ACCOUNT=""

while [ $# -gt 0 ]; do
  case "$1" in
    --customer)        CUSTOMER="$2"; shift 2 ;;
    --driver)          DRIVER="$2"; shift 2 ;;
    --restaurant)      RESTAURANT="$2"; shift 2 ;;
    --service-account) SERVICE_ACCOUNT="$2"; shift 2 ;;
    -h|--help)         sed -n '2,34p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "Unknown argument: $1" >&2; exit 2 ;;
  esac
done

if [ -z "$CUSTOMER" ] || [ -z "$DRIVER" ] || [ -z "$RESTAURANT" ] || [ -z "$SERVICE_ACCOUNT" ]; then
  echo "All four files are required. See --help, or docs/ANDROID-PUSH-FCM.md." >&2
  exit 2
fi

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

fail() { echo "  ✗ $1" >&2; exit 1; }

# --- validation, before anything is uploaded -------------------------------
#
# Everything is checked first. A partial upload — two apps configured, one not
# — is worse than none, because the two that work make it look done.

echo "Validating files before uploading anything…"

for f in "$CUSTOMER" "$DRIVER" "$RESTAURANT" "$SERVICE_ACCOUNT"; do
  [ -f "$f" ] || fail "not found: $f"
  node -e "JSON.parse(require('fs').readFileSync('$f','utf8'))" 2>/dev/null \
    || fail "not valid JSON: $f"
done

# The service account must be a service account.
SA_PROJECT=$(node -e "
  const j = JSON.parse(require('fs').readFileSync('$SERVICE_ACCOUNT','utf8'));
  if (j.type !== 'service_account') { console.error('type is ' + JSON.stringify(j.type)); process.exit(1); }
  if (!j.private_key) { console.error('no private_key'); process.exit(1); }
  process.stdout.write(j.project_id || '');
") || fail "$SERVICE_ACCOUNT is not a service-account key. Firebase console → Project settings → Service accounts → Generate new private key."

echo "  ✓ service account is valid (project: $SA_PROJECT)"

check_google_services() {
  local app="$1" file="$2" want_pkg="$3"
  local out
  out=$(node -e "
    const j = JSON.parse(require('fs').readFileSync('$file','utf8'));
    const pkgs = (j.client || [])
      .map(c => c.client_info && c.client_info.android_client_info && c.client_info.android_client_info.package_name)
      .filter(Boolean);
    if (!pkgs.includes('$want_pkg')) {
      console.error('contains [' + pkgs.join(', ') + '] but not $want_pkg');
      process.exit(1);
    }
    process.stdout.write((j.project_info && j.project_info.project_id) || '');
  ") || fail "$file is not the $app file — $(node -e "
    const j=JSON.parse(require('fs').readFileSync('$file','utf8'));
    process.stdout.write(((j.client||[]).map(c=>c.client_info&&c.client_info.android_client_info&&c.client_info.android_client_info.package_name).filter(Boolean)).join(', ')||'no android packages');
  ")"

  [ "$out" = "$SA_PROJECT" ] || fail "$app google-services.json is from Firebase project '$out' but the service account is from '$SA_PROJECT'. Mixing projects is what produces MismatchSenderId at send time. Use one project for all of them."

  echo "  ✓ $app → $want_pkg (project: $out)"
}

check_google_services customer   "$CUSTOMER"   eg.sharmeats.customer
check_google_services driver     "$DRIVER"     eg.sharmeats.driver
check_google_services restaurant "$RESTAURANT" eg.sharmeats.restaurant

# --- upload ----------------------------------------------------------------

echo
echo "Uploading GOOGLE_SERVICES_JSON to each EAS project…"

upload() {
  local app="$1" file="$2"
  local abs; abs="$(cd "$(dirname "$file")" && pwd)/$(basename "$file")"
  echo "  apps/$app…"
  # env:set rather than the deprecated env:create: it is create-or-update, so
  # re-running this script after fixing one file is safe and needs no --force.
  ( cd "apps/$app" && npx eas-cli@21.4.0 env:set \
      --environment production \
      --name GOOGLE_SERVICES_JSON \
      --type file \
      --value "$abs" \
      --visibility sensitive \
      --non-interactive )
}

upload customer   "$CUSTOMER"
upload driver     "$DRIVER"
upload restaurant "$RESTAURANT"

echo
echo "✓ google-services.json uploaded for all three apps."
echo
cat <<EOF
REMAINING STEP — interactive, cannot be scripted:

  Upload the FCM V1 service account to each app's Android credentials. Without
  it the apps get push tokens and every send is still rejected at Expo's relay.

    for app in customer driver restaurant; do
      (cd apps/\$app && npx eas-cli@21.4.0 credentials --platform android)
    done

  In each: production → Google Service Account → "Manage your Google Service
  Account Key for Push Notifications (FCM V1)" → upload:
    $SERVICE_ACCOUNT

  The same file goes to all three — they share one Firebase project.

THEN REBUILD. Android push is compiled in; no OTA can deliver it, and any
build made before this upload has push permanently dead.

  GitHub → Actions → "EAS build" → app: <app>, platform: android

Verification steps (do not trust a green build): docs/ANDROID-PUSH-FCM.md
EOF
