import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Locally, pin the workspace root so Next doesn't crawl up to ~/package-lock.json.
  // On Vercel the project root IS this app dir, so escaping it with '../..' breaks
  // output tracing (doubled /vercel/path0 path) — only set it off-Vercel.
  ...(process.env.VERCEL ? {} : { outputFileTracingRoot: path.join(__dirname, '../..') }),
  images: {
    remotePatterns: [{ protocol: 'https', hostname: '**' }],
  },
};

export default nextConfig;
