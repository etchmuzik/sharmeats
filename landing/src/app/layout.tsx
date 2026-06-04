import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'sharmeats — food delivery built for Sharm El Sheikh',
  description:
    'Five languages. Hotel-room delivery. Honest ETAs with credits when we miss them. The food app tourists and residents actually want.',
  openGraph: {
    title: 'sharmeats — food delivery built for Sharm El Sheikh',
    description:
      'Five languages. Hotel-room delivery. Honest ETAs with credits when we miss them.',
    type: 'website',
  },
  // Sharm Eats logo (bold stacked wordmark tile) — generated into public/brand.
  icons: {
    icon: [
      { url: '/brand/favicon.ico', sizes: 'any' },
      { url: '/brand/icon-32.png', type: 'image/png', sizes: '32x32' },
      { url: '/brand/icon-192.png', type: 'image/png', sizes: '192x192' },
    ],
    apple: [{ url: '/brand/apple-touch-icon.png', sizes: '180x180' }],
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
