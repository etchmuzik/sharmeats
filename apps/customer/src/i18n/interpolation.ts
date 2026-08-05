import type { Locale } from '../store/session';

const INTL_LOCALES: Record<Locale, string> = {
  en: 'en-US',
  ar: 'ar-EG',
  ru: 'ru-RU',
  it: 'it-IT',
  de: 'de-DE',
};

/**
 * Formats a value intended for a translated placeholder.
 *
 * Translation strings sometimes carry names, codes, or already-formatted
 * values, so strings must remain byte-for-byte unchanged. Numeric values use
 * the customer's numeral system; English intentionally retains the old
 * String(number) representation unless a caller explicitly requests a display
 * option such as zero-padding.
 */
export function formatLocalizedNumber(
  value: string | number,
  locale: Locale,
  options?: Intl.NumberFormatOptions,
): string {
  if (typeof value === 'string' || !Number.isFinite(value)) return String(value);

  if (locale === 'en' && !options) return String(value);

  return new Intl.NumberFormat(INTL_LOCALES[locale], {
    useGrouping: false,
    maximumFractionDigits: 20,
    ...options,
  }).format(value);
}

/** Substitute the app's single-brace translation placeholders safely. */
export function interpolateTranslation(
  template: string,
  locale: Locale,
  vars?: Record<string, string | number>,
): string {
  if (!vars) return template;

  let output = template;
  for (const [key, value] of Object.entries(vars)) {
    output = output.replace(`{${key}}`, formatLocalizedNumber(value, locale));
  }
  return output;
}
