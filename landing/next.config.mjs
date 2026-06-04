import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Locally, pin the workspace root to this app so Next doesn't crawl up to
  // ~/package-lock.json. On Vercel the project root IS this app dir, so setting
  // it breaks output tracing (doubled /vercel/path0 path) — only set it
  // off-Vercel. Matches apps/{admin,merchant}-web (commit 7e402c3).
  ...(process.env.VERCEL ? {} : { outputFileTracingRoot: __dirname }),
};

export default nextConfig;
