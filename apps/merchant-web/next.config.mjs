import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// STATIC_EXPORT=1 builds a fully static SPA for Hostinger shared hosting (no
// Node). The dashboard is now client-only (localStorage auth + Realtime), so it
// exports cleanly. Default builds keep the dynamic server.
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
  `connect-src 'self' https://*.supabase.co wss://*.supabase.co https://*.sentry.io${DEV ? ' http: ws:' : ''}`,
  "worker-src 'self' blob:",
  "manifest-src 'self'",
  ...(DEV ? [] : ['upgrade-insecure-requests']),
].join('; ');

const securityHeaders = [
  { key: 'Content-Security-Policy', value: contentSecurityPolicy },
  { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(self), payment=(), usb=()' },
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Static builds generate maps only as temporary Sentry upload inputs. The
  // finalizer removes maps and sourceMappingURL comments before deployment.
  // Server-hosted builds do not expose browser maps at all.
  productionBrowserSourceMaps: STATIC_EXPORT,
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
        async headers() {
          return [{ source: '/:path*', headers: securityHeaders }];
        },
      }),
};

export default nextConfig;
