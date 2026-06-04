import { useSession, type Locale } from '../store/session';
import en from './locales/en.json';
import ar from './locales/ar.json';

type Dict = Record<string, string>;

const DICTS: Partial<Record<Locale, Dict>> = {
  en: en as Dict,
  ar: ar as Dict,
};

/**
 * Tiny translation hook. Falls back to the key itself if missing.
 * Real app will use i18next + ICU plurals in Phase 3.
 */
export function useT(): (key: string, vars?: Record<string, string | number>) => string {
  const locale = useSession((s) => s.locale);
  return (key: string, vars?: Record<string, string | number>) => {
    const dict = DICTS[locale] ?? DICTS.en!;
    let out = dict[key] ?? (DICTS.en as Dict)[key] ?? key;
    if (vars) {
      for (const [k, v] of Object.entries(vars)) {
        out = out.replace(`{${k}}`, String(v));
      }
    }
    return out;
  };
}

export const isRtl = (locale: Locale): boolean => locale === 'ar';

export const LOCALE_LABELS: Record<Locale, string> = {
  en: 'English',
  ar: 'العربية',
  ru: 'Русский',
  it: 'Italiano',
  de: 'Deutsch',
};

export const ALL_LOCALES: Locale[] = ['en', 'ar', 'ru', 'it', 'de'];
