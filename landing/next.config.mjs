import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

// STATIC_EXPORT=1 produces a fully static `out/` for Apache/shared hosting
// (Hostinger). It drops the Node server, so API routes can't run and
// next/image must be unoptimized; the AASA Content-Type header (below) is
// instead supplied by public/.htaccess in the export. Default builds (incl.
// Vercel) keep the dynamic server + headers().
const STATIC_EXPORT = process.env.STATIC_EXPORT === '1';
const DEV = process.env.NODE_ENV !== 'production';

const contentSecurityPolicy = [
  "default-src 'self'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "object-src 'none'",
  `script-src 'self' 'unsafe-inline'${DEV ? " 'unsafe-eval'" : ''}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  `connect-src 'self' https://*.supabase.co wss://*.supabase.co${DEV ? ' http: ws:' : ''}`,
  "frame-src https://www.openstreetmap.org",
  "worker-src 'self' blob:",
  "manifest-src 'self'",
  ...(DEV ? [] : ['upgrade-insecure-requests']),
].join('; ');

// /screenshots is internal tooling (App Store poster generator). It is
// quarantined out of the public export by scripts/build-hostinger.sh and never
// ships to sharmeats.online, but it DOES render under `next dev` and on
// Vercel, where it loads the Phosphor icon webfont from unpkg — its script,
// the stylesheet it injects, and that stylesheet's @font-face URLs. Widening
// the site-wide policy for one internal page would be the wrong trade, so the
// CDN is allowed on this route only.
const screenshotsContentSecurityPolicy = contentSecurityPolicy
  .replace("script-src 'self' 'unsafe-inline'", "script-src 'self' 'unsafe-inline' https://unpkg.com")
  .replace("style-src 'self' 'unsafe-inline'", "style-src 'self' 'unsafe-inline' https://unpkg.com")
  .replace("font-src 'self' data:", "font-src 'self' data: https://unpkg.com");

const securityHeaders = [
  { key: 'Content-Security-Policy', value: contentSecurityPolicy },
  { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=(), usb=()' },
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Locally, pin the workspace root to this app so Next doesn't crawl up to
  // ~/package-lock.json. On Vercel the project root IS this app dir, so setting
  // it breaks output tracing (doubled /vercel/path0 path) — only set it
  // off-Vercel. Matches apps/{admin,merchant}-web (commit 7e402c3).
  ...(process.env.VERCEL ? {} : { outputFileTracingRoot: __dirname }),
  ...(STATIC_EXPORT
    ? {
        output: 'export',
        // Apache serves /privacy/ → /privacy/index.html cleanly with trailing
        // slashes; avoids needing per-route rewrites for clean URLs.
        trailingSlash: true,
        // No Next image optimizer on static hosting.
        images: { unoptimized: true },
      }
    : {
        async headers() {
          return [
            // Every matching entry is applied and the LAST value for a header
            // wins, so the /screenshots override must come AFTER the catch-all
            // (verified against `next dev`: with it first, the catch-all
            // policy overwrote it and unpkg stayed blocked). `:path*` matches
            // zero segments, so this covers bare /screenshots too.
            { source: '/:path*', headers: securityHeaders },
            {
              source: '/screenshots/:path*',
              headers: securityHeaders.map((header) =>
                header.key === 'Content-Security-Policy'
                  ? { ...header, value: screenshotsContentSecurityPolicy }
                  : header,
              ),
            },
            {
              // Apple requires the AASA file served as application/json (no
              // .json extension → Next would otherwise guess the wrong type).
              // In STATIC_EXPORT this is handled by public/.htaccess instead.
              source: '/.well-known/apple-app-site-association',
              headers: [{ key: 'Content-Type', value: 'application/json' }],
            },
          ];
        },
      }),
};

export default nextConfig;
