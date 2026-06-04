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
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
