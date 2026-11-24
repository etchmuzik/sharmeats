import en from './copy/en.json';
import ar from './copy/ar.json';
import ru from './copy/ru.json';
import it from './copy/it.json';
import de from './copy/de.json';
import type { Lang } from './routes';

export const copy: Record<Lang, typeof en> = { en, ar, ru, it, de };
export const pilots = {
  'naama-bay': 'naama',
  'nabq-bay': 'nabq',
  hadaba: 'hadaba',
} as const;
export type Pilot = keyof typeof pilots;

// Public delivery_fee_rules, food vertical, verified 2026-11-24.
// The authoritative address-specific price is quoted by the app at checkout.
export const baseFees: Record<string, number> = {
  naama: 30,
  nabq: 40,
  hadaba: 25,
  old_market: 25,
  soho: 30,
  sharks_bay: 35,
  el_salam: 25,
  mubarak_7: 20,
  el_rowaisat: 20,
  hay_el_nour: 20,
  el_hadaba_residential: 25,
};

export function money(lang: Lang, amount: number) {
  return new Intl.NumberFormat(lang === 'ar' ? 'ar-EG' : lang, {
    style: 'currency',
    currency: 'EGP',
    maximumFractionDigits: 0,
    minimumFractionDigits: 0,
  }).format(amount);
}

export function guideMeta(lang: Lang, path: string) {
  const c = copy[lang];
  const pages = {
    '': c.home,
    'delivery-areas': c.areas,
    'hotel-delivery': c.hotels,
    'how-it-works': c.how,
    restaurants: c.restaurants,
    order: c.order,
    prototype: c.demo,
    'areas/naama-bay': c.naama,
    'areas/nabq-bay': c.nabq,
    'areas/hadaba': c.hadaba,
  };
  return pages[path as keyof typeof pages];
}
