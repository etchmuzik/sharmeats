import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { origin, parseRoute } from '@/components/search/routes';
import { SearchEvents } from '@/components/search/SearchEvents';
import '@/app/globals.css';
import '@/components/search/home-fonts.css';

export const metadata: Metadata = {
  metadataBase: new URL(origin),
  icons: { icon: '/brand/icon-32.png', apple: '/brand/apple-touch-icon.png' },
  itunes: { appId: '6776864451' },
};

export default async function SearchLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ parts?: string[] }>;
}) {
  const { lang } = parseRoute((await params).parts);
  return (
    <html lang={lang} dir={lang === 'ar' ? 'rtl' : 'ltr'}>
      <body>
        {children}
        <SearchEvents lang={lang} />
      </body>
    </html>
  );
}
