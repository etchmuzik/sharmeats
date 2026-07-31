#!/usr/bin/env bash
#
# Build the Sharm Eats landing site as a STATIC export for Hostinger shared
# hosting (Apache/LiteSpeed, no Node). Produces ./out with only the public
# marketing pages.
#
# Internal-tooling pages (/screenshots, /brand) are quarantined out of
# src/app during the build so they (a) don't ship publicly and (b) don't break
# `output: export` (the /screenshots page uses searchParams). They are ALWAYS
# restored afterward, even if the build fails.
#
# Usage:  ./scripts/build-hostinger.sh
# Output: ./out  (upload its contents to ~/domains/sharmeats.online/public_html/)

set -euo pipefail
cd "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

APP="src/app"
QUARANTINE=".hostinger-quarantine"
PAGES=("screenshots" "brand")

# ---------------------------------------------------------------------------
# Version manifest — FIRST, and deliberately so on both counts.
#
# WHY IT IS HERE AT ALL: this script runs `npx next build`, which does NOT fire
# npm's `prebuild` hook. So the one build path that actually produces
# production skipped the manifest entirely, while `npm run build` — the path
# nobody deploys from — wrote it. `landing/public/version.json` is gitignored,
# so on a clean CI checkout the deployed site would have carried NO
# /version.json at all, and locally it shipped whatever stale copy was lying
# around: on 2026-07-30 the live site served commit b70b806 while HEAD was four
# commits further on. A version file that is believed and wrong is worse than
# none, which is the exact thing write-version-manifest.mjs exists to prevent.
#
# WHY BEFORE THE QUARANTINE: the generator refuses to write a manifest from a
# dirty tree when CI=true, and quarantining moves two directories out of
# src/app — which makes the tree dirty. Generating after the mv would fail
# every CI deploy with a message about uncommitted changes that nobody
# uncommitted. Order is load-bearing; keep it.
# ---------------------------------------------------------------------------
echo "→ Writing version manifest…"
node ../scripts/write-version-manifest.mjs --surface landing

restore() {
  if [ -d "$QUARANTINE" ]; then
    for p in "${PAGES[@]}"; do
      [ -d "$QUARANTINE/$p" ] && mv "$QUARANTINE/$p" "$APP/$p"
    done
    rmdir "$QUARANTINE" 2>/dev/null || true
    echo "  ↺ restored internal pages (${PAGES[*]})"
  fi
}
trap restore EXIT  # restore on success, failure, or Ctrl-C

echo "→ Quarantining internal pages…"
mkdir -p "$QUARANTINE"
for p in "${PAGES[@]}"; do
  if [ -d "$APP/$p" ]; then
    mv "$APP/$p" "$QUARANTINE/$p"
    echo "  • $p"
  fi
done

echo "→ Building static export (STATIC_EXPORT=1)…"
STATIC_EXPORT=1 npx next build

echo "→ Copying .htaccess into out/ …"
cp public/.htaccess out/.htaccess 2>/dev/null || echo "  (no public/.htaccess found — skipping)"

# Note: public/screenshots/{home-1,item-hero,ar-1}.jpg + public/app/*.png are
# load-bearing marketing imagery for the homepage now — do NOT prune them. The
# internal /screenshots and /brand *routes* are excluded via the quarantine
# step above; only the public asset folders ship.

echo "✓ Static site built → ./out"
echo "  Upload its contents to ~/domains/sharmeats.online/public_html/"
