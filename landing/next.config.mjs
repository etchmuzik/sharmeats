import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

// STATIC_EXPORT=1 produces a fully static `out/` for Apache/shared hosting
// (Hostinger). It drops the Node server, so API routes can't run and
// next/image must be unoptimized; the AASA Content-Type header (below) is
// instead supplied by public/.htaccess in the export. Default builds (incl.
// Vercel) keep the dynamic server + headers().
const STATIC_EXPORT = process.env.STATIC_EXPORT === '1';

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
