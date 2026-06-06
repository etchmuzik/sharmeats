import type { Metadata } from 'next';
import './globals.css';
import { ToastProvider } from './Toast';

export const metadata: Metadata = {
  title: 'Sharm Eats — Merchant',
  description: 'Receive and manage your Sharm Eats orders.',
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
