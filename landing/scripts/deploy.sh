#!/usr/bin/env bash
#
# Deploy the Sharm Eats landing app to Vercel (production).
#
# One-command deploy after a one-time `vercel login`. Idempotent and guided:
# it checks auth, links the project on first run, sanity-checks env vars, runs
# a local production build as a pre-flight, then ships to production.
#
# Usage:
#   vercel login                 # one time, interactive
#   ./scripts/deploy.sh          # ship to production
#   ./scripts/deploy.sh --preview  # ship a preview deploy instead of prod
#
# Matches the sibling dashboards (sharmeats-merchant / sharmeats-admin):
# each app is its own Vercel project rooted at the app dir.

set -euo pipefail

# ---- resolve to the landing app dir (script lives in landing/scripts) ----
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$APP_DIR"

PROJECT_NAME="sharmeats-landing"
TEAM_SCOPE="team_XRBYWAi4bngYhH8lnLTKQ1Al" # same team as the dashboards
PROD=1
[ "${1:-}" = "--preview" ] && PROD=0

bold() { printf "\033[1m%s\033[0m\n" "$1"; }
ok()   { printf "  \033[32m✓\033[0m %s\n" "$1"; }
warn() { printf "  \033[33m!\033[0m %s\n" "$1"; }
die()  { printf "  \033[31m✗ %s\033[0m\n" "$1"; exit 1; }

bold "Sharm Eats landing → Vercel"
echo "  app dir: $APP_DIR"
echo

# ---- 1. Vercel CLI present ----
command -v vercel >/dev/null 2>&1 || die "Vercel CLI not found. Install: npm i -g vercel"
ok "vercel CLI: $(vercel --version 2>/dev/null | tail -1)"

# ---- 2. authenticated ----
if ! vercel whoami >/dev/null 2>&1; then
  die "Not logged in. Run:  vercel login   then re-run this script."
fi
ok "logged in as: $(vercel whoami 2>/dev/null | tail -1)"

# ---- 3. project linked (first run creates the link) ----
if [ ! -f ".vercel/project.json" ]; then
  warn "No .vercel link yet — linking project '$PROJECT_NAME'…"
  vercel link --yes --project "$PROJECT_NAME" --scope "$TEAM_SCOPE" \
    || die "vercel link failed. Run 'vercel link' manually, then re-run."
  ok "linked: $PROJECT_NAME"
else
  ok "project linked ($(grep -o '\"projectName\":\"[^\"]*\"' .vercel/project.json | cut -d'\"' -f4))"
fi

# ---- 4. env var sanity check (warn-only; the waitlist API needs these) ----
ENV_LS="$(vercel env ls production 2>/dev/null || true)"
for v in NEXT_PUBLIC_SUPABASE_URL SUPABASE_SERVICE_ROLE_KEY; do
  if echo "$ENV_LS" | grep -q "$v"; then
    ok "env present: $v"
  else
    warn "env MISSING: $v  (add with: vercel env add $v production)"
  fi
done
echo

# ---- 5. pre-flight: local production build must pass ----
bold "Pre-flight build…"
if npm run build >/tmp/sharmeats-landing-build.log 2>&1; then
  ok "local build passed"
else
  tail -20 /tmp/sharmeats-landing-build.log
  die "local build failed (see /tmp/sharmeats-landing-build.log) — fix before deploying."
fi
echo

# ---- 6. deploy ----
if [ "$PROD" = "1" ]; then
  bold "Deploying to PRODUCTION…"
  vercel deploy --prod --yes
else
  bold "Deploying a PREVIEW…"
  vercel deploy --yes
fi

echo
ok "Done. Pages: /  ·  /screenshots  ·  /brand"
