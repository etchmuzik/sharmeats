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
