import type { Metadata } from 'next';
import { Sora, Plus_Jakarta_Sans } from 'next/font/google';
import './globals.css';

// Brand display + UI faces (self-hosted via next/font). Mapped to Tailwind's
// font-display / font-sans in tailwind.config so the marketing site shares the
// app's identity (headlines were rendering in Georgia before).
const sora = Sora({ subsets: ['latin'], weight: ['500', '600', '700', '800'], variable: '--font-display' });
const jakarta = Plus_Jakarta_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-sans',
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
    <html lang="en" className={`${sora.variable} ${jakarta.variable}`}>
      <body>{children}</body>
    </html>
  );
}
