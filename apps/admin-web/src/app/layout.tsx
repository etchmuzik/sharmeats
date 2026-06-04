import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Sharm Eats — Ops',
  description: 'Dispatch board and live operations for Sharm Eats.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
