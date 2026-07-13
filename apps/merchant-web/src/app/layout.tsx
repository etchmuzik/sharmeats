import type { Metadata, Viewport } from 'next';
import './globals.css';
import { ToastProvider } from './Toast';
import { SentryInit } from './SentryInit';

export const metadata: Metadata = {
  title: 'Sharm Eats — Merchant',
  description: 'Receive and manage your Sharm Eats orders.',
};

export const viewport: Viewport = {
  themeColor: '#100e12',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <SentryInit />
        <ToastProvider>{children}</ToastProvider>
      </body>
    </html>
  );
}
