import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// STATIC_EXPORT=1 builds a fully static SPA for Hostinger shared hosting (no
// Node). The dashboard is now client-only (localStorage auth + Realtime), so it
// exports cleanly. Default builds keep the dynamic server.
const STATIC_EXPORT = process.env.STATIC_EXPORT === '1';

/**
 * Security headers for an ops dashboard that controls commission rates, credit
 * issuance, KYC approval and dispatch.
 *
 * These apply ONLY to the server build (`next dev` / `next start`). Next
 * cannot serve headers from a static export — there is no runtime — so the
 * production copy on Hostinger gets the identical set from
 * `public/.htaccess`, which Next copies into out/ verbatim. Both files must
 * change together; that is why each one says so.
 */
const SECURITY_HEADERS = [
  { key: 'Content-Security-Policy', value: "frame-ancestors 'none'" },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'no-referrer' },
  {
    key: 'Permissions-Policy',
    value: 'geolocation=(), camera=(), microphone=(), payment=(), usb=()',
  },
  { key: 'X-Robots-Tag', value: 'noindex, nofollow' },
  { key: 'Strict-Transport-Security', value: 'max-age=31536000' },
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Emit client-side .js.map files into the build output (out/ under
  // STATIC_EXPORT) so Sentry can symbolicate browser stack traces. Documented
  // Next.js flag; applies to production `next build` in both the export and
  // server branches below. Safe/no-op unless source maps are uploaded.
  //
  // The maps are BUILD artifacts, not SHIPPED ones: `npm run build:export`
  // uploads them to Sentry and then deletes them from out/ via
  // scripts/strip-sourcemaps.mjs. Without that step the dashboard publishes
  // its own readable source — every gate, RPC name and query — to anyone who
  // opens devtools.
  productionBrowserSourceMaps: true,
  // Locally, pin the workspace root so Next doesn't crawl up to ~/package-lock.json.
  ...(process.env.VERCEL ? {} : { outputFileTracingRoot: path.join(__dirname, '../..') }),
  ...(STATIC_EXPORT
    ? {
        output: 'export',
        trailingSlash: true,
        images: { unoptimized: true },
      }
    : {
        images: {
          remotePatterns: [{ protocol: 'https', hostname: '**' }],
        },
        // Only in the server branch: declaring headers() under
        // `output: 'export'` builds a config Next warns about and silently
        // ignores, which reads like protection that isn't there.
        async headers() {
          return [{ source: '/:path*', headers: SECURITY_HEADERS }];
        },
      }),
};

export default nextConfig;
