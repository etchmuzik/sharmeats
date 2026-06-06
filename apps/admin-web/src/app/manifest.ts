import type { MetadataRoute } from 'next';

// Required for `output: export` (static hosting on Hostinger) — prerender
// the manifest to a file at build time instead of serving it dynamically.
export const dynamic = 'force-static';

// PWA manifest for the admin/ops dashboard. Next renders this to
// /manifest.webmanifest and injects the <link rel="manifest"> tag.
// Icons are the shared Sharm Eats brand marks copied into public/.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Sharm Eats — Ops',
    short_name: 'SE Ops',
    description: 'Dispatch board and live operations for Sharm Eats.',
    start_url: '/',
    display: 'standalone',
    background_color: '#100e12',
    theme_color: '#100e12',
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
