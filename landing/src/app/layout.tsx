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

const SITE_URL = 'https://sharmeats.online';
// Mirrors APP_STORE_URL and the footer Instagram link in page.tsx (a client
// component, so the values are duplicated here for server-rendered metadata).
const APP_STORE_URL = 'https://apps.apple.com/eg/app/id6776864451';
const INSTAGRAM_URL = 'https://www.instagram.com/sharmeats';

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: 'sharmeats — food delivery built for Sharm El Sheikh',
  description:
    'Five languages. Hotel-room delivery. Honest ETAs with credits when we miss them. The food app tourists and residents actually want.',
  openGraph: {
    title: 'sharmeats — food delivery built for Sharm El Sheikh',
    description:
      'Five languages. Hotel-room delivery. Honest ETAs with credits when we miss them.',
    type: 'website',
    url: SITE_URL,
    images: [{ url: '/brand/og.jpg', width: 1200, height: 630 }],
  },
  twitter: { card: 'summary_large_image' },
  // iOS Smart App Banner — the customer app is live on the App Store, so
  // Safari visitors get the native install/open banner (renders the
  // apple-itunes-app meta tag).
  itunes: { appId: '6776864451' },
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

// Structured data for search results: the customer app install card plus the
// organization identity. Rendered in the layout (a server component) so it
// lands in the static HTML — page.tsx is 'use client'.
const structuredData = {
  '@context': 'https://schema.org',
  '@graph': [
    {
      '@type': 'SoftwareApplication',
      name: 'Sharm Eats',
      operatingSystem: 'iOS',
      applicationCategory: 'FoodBeverageApplication',
      installUrl: APP_STORE_URL,
      offers: { '@type': 'Offer', price: '0', priceCurrency: 'EGP' },
    },
    {
      '@type': 'Organization',
      name: 'Sharm Eats',
      url: SITE_URL,
      logo: `${SITE_URL}/brand/icon-512.png`,
      sameAs: [INSTAGRAM_URL],
    },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${urbanist.variable} ${tajawal.variable}`}>
      <body>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }}
        />
        {children}
      </body>
    </html>
  );
}
