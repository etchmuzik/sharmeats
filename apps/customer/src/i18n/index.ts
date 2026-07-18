import { useSession, type Locale } from '../store/session';
import en from './locales/en.json';
import ar from './locales/ar.json';
import ru from './locales/ru.json';
import it from './locales/it.json';
import de from './locales/de.json';

type Dict = Record<string, string>;

const DICTS: Partial<Record<Locale, Dict>> = {
  en: en as Dict,
  ar: ar as Dict,
  ru: ru as Dict,
  it: it as Dict,
  de: de as Dict,
};

function lookup(locale: Locale, key: string, vars?: Record<string, string | number>): string {
  const dict = DICTS[locale] ?? DICTS.en!;
  let out = dict[key] ?? (DICTS.en as Dict)[key] ?? key;
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      out = out.replace(`{${k}}`, String(v));
    }
  }
  return out;
}

/**
 * Tiny translation hook. Falls back to the key itself if missing.
 * Real app will use i18next + ICU plurals in Phase 3.
 */
export function useT(): (key: string, vars?: Record<string, string | number>) => string {
  const locale = useSession((s) => s.locale);
  return (key: string, vars?: Record<string, string | number>) => lookup(locale, key, vars);
}

/**
 * Non-hook translation for code that runs outside React components
 * (repositories, error mappers). Reads the live locale from the session
 * store at call time, so messages built here match the UI language.
 */
export function t(key: string, vars?: Record<string, string | number>): string {
  return lookup(useSession.getState().locale, key, vars);
}

export const isRtl = (locale: Locale): boolean => locale === 'ar';

export const LOCALE_LABELS: Record<Locale, string> = {
  en: 'English',
  ar: 'العربية',
  ru: 'Русский',
  it: 'Italiano',
  de: 'Deutsch',
};

// Only offer languages we actually ship translations for. it/de are declared in
// the Locale type + LOCALE_LABELS (so they're ready to enable) but have no JSON
// yet — listing them in the switcher would let a user pick a language that
// silently renders English. Derive the picker list from DICTS so adding
// it.json/de.json to DICTS later auto-enables them, with no drift here.
export const ALL_LOCALES: Locale[] = (Object.keys(DICTS) as Locale[]).filter(
  (l) => DICTS[l] != null,
);
