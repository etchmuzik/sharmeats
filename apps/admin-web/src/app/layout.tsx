import type { Metadata, Viewport } from 'next';
import './globals.css';
import { ToastProvider } from './Toast';

export const metadata: Metadata = {
  title: 'Sharm Eats — Ops',
  description: 'Dispatch board and live operations for Sharm Eats.',
};

export const viewport: Viewport = {
  themeColor: '#100e12',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <ToastProvider>{children}</ToastProvider>
      </body>
    </html>
  );
}
