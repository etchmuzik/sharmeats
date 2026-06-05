#!/usr/bin/env bash
#
# Build the Sharm Eats merchant dashboard as a STATIC SPA for Hostinger shared
# hosting (Apache, no Node). Output → ./out (upload to the vhost's public_html).
#
# Requires NEXT_PUBLIC_SUPABASE_URL + NEXT_PUBLIC_SUPABASE_ANON_KEY at build
# time (read from .env.local / .env). The anon key is safe in the client
# (RLS-gated). Usage:  ./scripts/build-hostinger.sh

set -euo pipefail
cd "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "→ Building static SPA (STATIC_EXPORT=1)…"
STATIC_EXPORT=1 npx next build

echo "→ Copying .htaccess into out/ …"
cp public/.htaccess out/.htaccess 2>/dev/null || echo "  (no public/.htaccess — skipping)"

echo "✓ Static dashboard built → ./out"
