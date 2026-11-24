import { catalogMeta, restaurantSlugs } from './Catalog';
import { guideMeta, pilots } from './guideData';
import type { Lang } from './routes';

export const searchPaths = [
  '',
  'delivery-areas',
  'hotel-delivery',
  'restaurants',
  'how-it-works',
  ...Object.keys(pilots).map((slug) => 'areas/' + slug),
  ...restaurantSlugs.map((slug) => 'restaurants/' + slug),
];
export const publicPaths = [
  ...searchPaths,
  'order',
  'prototype',
  'prototype/order',
];
const demoTitles: Record<Lang, string> = {
  en: 'Try the sample checkout',
  ar: 'جرّب الطلب التجريبي',
  ru: 'Демо оформления заказа',
  it: 'Prova il checkout dimostrativo',
  de: 'Bestellablauf ausprobieren',
};

export function pageInfo(lang: Lang, path: string) {
  if (path === 'restaurants' || path.startsWith('restaurants/')) {
    return catalogMeta(lang, path.split('/')[1]);
  }
  if (path === 'prototype/order') {
    return {
      title: demoTitles[lang],
      description: guideMeta(lang, 'prototype').summary,
    };
  }
  const guide = guideMeta(lang, path);
  return { title: guide.title, description: guide.summary };
}
