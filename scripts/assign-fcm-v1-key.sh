#!/usr/bin/env bash
#
# Assign the account's FCM V1 Google Service Account key to an app's Android
# credentials -- non-interactively.
#
# WHY THIS EXISTS. `eas credentials` is an interactive menu maze with no
# non-interactive mode, and assigning one already-uploaded key to three apps
# means walking the same five submenus three times. During the 2026-08-03 FCM
# setup the owner did the customer app through the menus, hit the same screen
# in a loop twice, and asked for a terminal way. This script is that way: it
# speaks the SAME GraphQL operations the menu runs, taken verbatim from the
# eas-cli 21.4.0 source (SetGoogleServiceAccountKeyForFcmV1Mutation and its
# two lookup queries), authenticated with the session the CLI already has.
#
# WHAT IT DOES, per app: look up the app's Android credentials row and its
# currently assigned FCM V1 key; skip if one is already assigned (idempotent);
# otherwise find the single service-account key uploaded to the account for
# the expected Firebase project and assign it. Nothing is uploaded and nothing
# is deleted -- the key must already exist on the account (the interactive
# customer-app setup created it).
#
# Usage, from the repo root on a machine logged into EAS:
#   ./scripts/assign-fcm-v1-key.sh                    # driver + restaurant
#   ./scripts/assign-fcm-v1-key.sh customer           # any subset
#
# Auth: EXPO_TOKEN if set, else the CLI session in ~/.expo/state.json.

set -euo pipefail

ACCOUNT="etchmuzik"
FIREBASE_PROJECT="sharm-eats"
GRAPHQL="https://api.expo.dev/graphql"

# if/else rather than "${@:-...}": referencing "$@" with zero args under
# set -u is an "unbound variable" error on bash < 4.4, and macOS ships 3.2.
if [ $# -gt 0 ]; then APPS=("$@"); else APPS=(driver restaurant); fi

command -v jq >/dev/null || { echo "jq is required (brew install jq)" >&2; exit 1; }

# --- auth -------------------------------------------------------------------
AUTH_HEADER=""
if [ -n "${EXPO_TOKEN:-}" ]; then
  AUTH_HEADER="Authorization: Bearer ${EXPO_TOKEN}"
else
  STATE="${HOME}/.expo/state.json"
  [ -f "$STATE" ] || { echo "Not logged in: no EXPO_TOKEN and no ${STATE}. Run 'npx eas-cli whoami' first." >&2; exit 1; }
  SESSION="$(jq -r '.auth.sessionSecret // empty' "$STATE")"
  [ -n "$SESSION" ] || { echo "No sessionSecret in ${STATE}. Run 'npx eas-cli login' first." >&2; exit 1; }
  AUTH_HEADER="expo-session: ${SESSION}"
fi

# One POST, fail on transport or GraphQL errors, print .data on stdout.
gql() { # $1 = full request body built with jq
  local resp
  resp="$(curl -fsS --max-time 30 "$GRAPHQL" \
            -H "$AUTH_HEADER" -H 'Content-Type: application/json' \
            --data "$1")" || { echo "network error talking to ${GRAPHQL}" >&2; return 1; }
  if [ "$(jq 'has("errors")' <<<"$resp")" = "true" ]; then
    echo "GraphQL error: $(jq -c '.errors' <<<"$resp")" >&2
    return 1
  fi
  jq '.data' <<<"$resp"
}

# --- the account's key for this Firebase project, once ----------------------
# Exactly-one is enforced: with two keys for the same project a silent pick
# could assign a revoked one, which fails only at send time.
keys_body="$(jq -n --arg acct "$ACCOUNT" '{
  query: "query($acct:String!){account{byName(accountName:$acct){id googleServiceAccountKeysPaginated(first:50){edges{node{id clientEmail privateKeyIdentifier projectIdentifier}}}}}}",
  variables: {acct: $acct}
}')"
keys="$(gql "$keys_body")" || exit 1
matches="$(jq --arg p "$FIREBASE_PROJECT" \
  '[.account.byName.googleServiceAccountKeysPaginated.edges[].node | select(.projectIdentifier == $p)]' <<<"$keys")"
n="$(jq 'length' <<<"$matches")"
if [ "$n" -ne 1 ]; then
  echo "Expected exactly 1 uploaded service-account key for Firebase project '${FIREBASE_PROJECT}', found ${n}:" >&2
  jq -r '.[] | "  " + .clientEmail + "  keyId " + .privateKeyIdentifier' <<<"$matches" >&2
  echo "Upload/remove keys via 'eas credentials' so exactly one remains, then re-run." >&2
  exit 1
fi
KEY_ID="$(jq -r '.[0].id' <<<"$matches")"
KEY_EMAIL="$(jq -r '.[0].clientEmail' <<<"$matches")"
echo "Using key ${KEY_EMAIL} ($(jq -r '.[0].privateKeyIdentifier' <<<"$matches"))"

# --- per app ----------------------------------------------------------------
fail=0
for app in "${APPS[@]}"; do
  case "$app" in
    customer|driver|restaurant) ;;
    *) echo "unknown app '${app}' (expected customer/driver/restaurant)" >&2; fail=1; continue ;;
  esac
  full_name="@${ACCOUNT}/sharmeats-${app}"
  pkg="eg.sharmeats.${app}"

  cred_body="$(jq -n --arg fn "$full_name" --arg pkg "$pkg" '{
    query: "query($fn:String!,$pkg:String){app{byFullName(fullName:$fn){id androidAppCredentials(filter:{applicationIdentifier:$pkg}){id applicationIdentifier googleServiceAccountKeyForFcmV1{id clientEmail}}}}}",
    variables: {fn: $fn, pkg: $pkg}
  }')"
  creds="$(gql "$cred_body")" || { fail=1; continue; }

  cred_id="$(jq -r '.app.byFullName.androidAppCredentials[0].id // empty' <<<"$creds")"
  if [ -z "$cred_id" ]; then
    # No credentials row means no keystore either -- this app has never been
    # configured. Creating one here would silently take over signing setup;
    # that decision belongs in the interactive tool.
    echo "x ${app}: no Android credentials exist for ${pkg} -- run 'eas credentials' once for this app first" >&2
    fail=1; continue
  fi

  current="$(jq -r '.app.byFullName.androidAppCredentials[0].googleServiceAccountKeyForFcmV1.clientEmail // empty' <<<"$creds")"
  if [ -n "$current" ]; then
    echo "= ${app}: FCM V1 key already assigned (${current}) -- skipping"
    continue
  fi

  mut_body="$(jq -n --arg cid "$cred_id" --arg kid "$KEY_ID" '{
    query: "mutation($cid:ID!,$kid:ID!){androidAppCredentials{setGoogleServiceAccountKeyForFcmV1(id:$cid,googleServiceAccountKeyId:$kid){id googleServiceAccountKeyForFcmV1{clientEmail privateKeyIdentifier}}}}",
    variables: {cid: $cid, kid: $kid}
  }')"
  out="$(gql "$mut_body")" || { fail=1; continue; }

  got="$(jq -r '.androidAppCredentials.setGoogleServiceAccountKeyForFcmV1.googleServiceAccountKeyForFcmV1.clientEmail // empty' <<<"$out")"
  if [ "$got" = "$KEY_EMAIL" ]; then
    echo "+ ${app}: FCM V1 key assigned to ${pkg}"
  else
    echo "x ${app}: mutation returned unexpected state: $(jq -c . <<<"$out")" >&2
    fail=1
  fi
done

exit "$fail"
