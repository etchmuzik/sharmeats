import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// STATIC_EXPORT=1 builds a fully static SPA for Hostinger shared hosting (no
// Node). The dashboard is now client-only (localStorage auth + Realtime), so it
// exports cleanly. Default builds keep the dynamic server.
const STATIC_EXPORT = process.env.STATIC_EXPORT === '1';

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Emit client-side .js.map files into the build output (out/ under
  // STATIC_EXPORT) so Sentry can symbolicate browser stack traces. Documented
  // Next.js flag; applies to production `next build` in both the export and
  // server branches below. Safe/no-op unless source maps are uploaded.
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
      }),
};

export default nextConfig;
