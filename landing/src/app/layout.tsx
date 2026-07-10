import type { Metadata } from 'next';
import { Urbanist, Tajawal } from 'next/font/google';
import './globals.css';

// Landing v2 typefaces (Claude Design handoff): Urbanist for Latin scripts,
// Tajawal as the Arabic companion — stacked so RTL copy falls through to
// Tajawal automatically, exactly like the design's --body stack.
const urbanist = Urbanist({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700', '800'],
  variable: '--font-urbanist',
});
const tajawal = Tajawal({
  subsets: ['arabic'],
  weight: ['400', '500', '700', '800'],
  variable: '--font-tajawal',
});

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
  // iOS Smart App Banner — emits <meta name="apple-itunes-app" content="app-id=6776864451">
  // so Safari on iOS offers a native install/open prompt for the live customer app.
  itunes: {
    appId: '6776864451',
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
    <html lang="en" className={`${urbanist.variable} ${tajawal.variable}`}>
      <body>{children}</body>
    </html>
  );
}
