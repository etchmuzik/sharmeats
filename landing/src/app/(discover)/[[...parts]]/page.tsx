import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import Home from '@/components/search/Home';
import Prototype from '@/components/search/prototype/Prototype';
import OrderPreview from '@/components/search/prototype/OrderPreview';
import { Catalog } from '@/components/search/Catalog';
import { Guide, GuideFrame } from '@/components/search/Guide';
import { copy } from '@/components/search/guideData';
import { pageInfo, publicPaths, searchPaths } from '@/components/search/pages';
import {
  alternates,
  appStoreUrl,
  languages,
  localized,
  origin,
  parseRoute,
} from '@/components/search/routes';

type Params = { parts?: string[] };
export const dynamicParams = false;
export function generateStaticParams(): Params[] {
  return languages.flatMap((lang) =>
    publicPaths.map((path) => ({
      parts: localized(lang, path).split('/').filter(Boolean),
    })),
  );
}

async function getPage(params: Promise<Params>) {
  const { lang, path } = parseRoute((await params).parts);
  if (!publicPaths.includes(path)) notFound();
  return {
    lang,
    path,
    ...pageInfo(lang, path),
    url: origin + localized(lang, path),
  };
}

export async function generateMetadata({
  params,
}: {
  params: Promise<Params>;
}): Promise<Metadata> {
  const { lang, path, title, description, url } = await getPage(params);
  const fullTitle = title + ' | Sharm Eats';
  return {
    title: fullTitle,
    description,
    alternates: { canonical: url, languages: alternates(path) },
    robots: { index: searchPaths.includes(path), follow: true },
    openGraph: {
      type: 'website',
      siteName: 'Sharm Eats',
      url,
      title: fullTitle,
      description,
      locale: {
        en: 'en_GB',
        ar: 'ar_EG',
        ru: 'ru_RU',
        it: 'it_IT',
        de: 'de_DE',
      }[lang],
      images: [{ url: '/brand/og.jpg', width: 1200, height: 630 }],
    },
    twitter: {
      card: 'summary_large_image',
      title: fullTitle,
      description,
      images: ['/brand/og.jpg'],
    },
  };
}

export default async function Page({ params }: { params: Promise<Params> }) {
  const { lang, path, title, description, url } = await getPage(params);
  const nav = copy[lang].nav;
  let content;
  if (!path) content = <Home lang={lang} />;
  else if (path === 'prototype') content = <Prototype lang={lang} />;
  else if (path === 'prototype/order') content = <OrderPreview lang={lang} />;
  else {
    content = (
      <GuideFrame lang={lang} path={path} title={title}>
        {path === 'restaurants' || path.startsWith('restaurants/') ? (
          <Catalog lang={lang} slug={path.split('/')[1]} />
        ) : (
          <Guide lang={lang} path={path} />
        )}
      </GuideFrame>
    );
  }

  const crumbs = [{ name: nav.home, item: origin + localized(lang) }];
  if (path.startsWith('areas/'))
    crumbs.push({
      name: nav.areas,
      item: origin + localized(lang, 'delivery-areas'),
    });
  if (path.startsWith('restaurants/'))
    crumbs.push({
      name: nav.menus,
      item: origin + localized(lang, 'restaurants'),
    });
  if (path) crumbs.push({ name: title, item: url });
  const schema = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'Organization',
        '@id': origin + '/#organization',
        name: 'Sharm Eats',
        url: origin + '/',
        logo: origin + '/brand/icon-512.png',
        sameAs: ['https://www.instagram.com/sharmeats'],
      },
      {
        '@type': 'WebSite',
        '@id': origin + '/#website',
        name: 'Sharm Eats',
        url: origin + '/',
        inLanguage: languages,
        publisher: { '@id': origin + '/#organization' },
      },
      {
        '@type': 'WebPage',
        '@id': url + '#page',
        url,
        name: title,
        description,
        inLanguage: lang,
        isPartOf: { '@id': origin + '/#website' },
        ...(path ? { breadcrumb: { '@id': url + '#breadcrumb' } } : {}),
      },
      ...(path
        ? [
            {
              '@type': 'BreadcrumbList',
              '@id': url + '#breadcrumb',
              itemListElement: crumbs.map((crumb, i) => ({
                '@type': 'ListItem',
                position: i + 1,
                ...crumb,
              })),
            },
          ]
        : [
            {
              '@type': 'SoftwareApplication',
              name: 'Sharm Eats',
              operatingSystem: 'iOS',
              applicationCategory: 'LifestyleApplication',
              installUrl: appStoreUrl,
              offers: { '@type': 'Offer', price: '0', priceCurrency: 'EGP' },
            },
          ]),
    ],
  };
  return (
    <>
      {content}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(schema).replace(/</g, '\\u003c'),
        }}
      />
    </>
  );
}
