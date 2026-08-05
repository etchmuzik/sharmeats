import type { Locale } from '../store/session';

const intlLocales: Record<Locale, string> = {
  en: 'en-US',
  ar: 'ar-EG',
  ru: 'ru-RU',
  it: 'it-IT',
  de: 'de-DE',
};

function isLegacyEnglish(locale: Locale | undefined): boolean {
  return locale === undefined || locale === 'en';
}

function localeIdentifier(locale: Locale | undefined): string {
  return intlLocales[locale ?? 'en'];
}

/**
 * Formats a plain customer-facing number in the active display language.
 * English intentionally preserves the existing `toLocaleString('en-US')`
 * result so callers can migrate without changing their legacy output.
 */
export function formatNumber(value: number, locale?: Locale): string {
  if (isLegacyEnglish(locale)) return value.toLocaleString('en-US');
  return new Intl.NumberFormat(localeIdentifier(locale)).format(value);
}

function formatUnit(
  value: number,
  unit: Intl.NumberFormatOptions['unit'],
  locale: Locale | undefined,
  options: Pick<
    Intl.NumberFormatOptions,
    'minimumFractionDigits' | 'maximumFractionDigits'
  > = {},
): string {
  return new Intl.NumberFormat(localeIdentifier(locale), {
    style: 'unit',
    unit,
    unitDisplay: 'short',
    ...options,
  }).format(value);
}

/**
 * Formats Egyptian pounds for the supplied display language. English remains
 * intentionally unchanged so existing one-argument callers are compatible.
 */
export function formatEgp(value: number, locale?: Locale): string {
  const rounded = Math.round(value);
  if (isLegacyEnglish(locale)) return `EGP ${rounded.toLocaleString('en-US')}`;

  return new Intl.NumberFormat(localeIdentifier(locale), {
    style: 'currency',
    currency: 'EGP',
    maximumFractionDigits: 0,
  }).format(rounded);
}

export function formatKm(meters: number, locale?: Locale): string {
  if (isLegacyEnglish(locale)) {
    if (meters < 950) return `${Math.round(meters / 10) * 10} m`;
    return `${(meters / 1000).toFixed(1)} km`;
  }

  if (meters < 950) {
    return formatUnit(Math.round(meters / 10) * 10, 'meter', locale, {
      maximumFractionDigits: 0,
    });
  }

  return formatUnit(Number((meters / 1000).toFixed(1)), 'kilometer', locale, {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });
}

export function formatMinutes(min: number, locale?: Locale): string {
  if (isLegacyEnglish(locale)) {
    if (min < 60) return `${min} min`;
    const h = Math.floor(min / 60);
    const m = min % 60;
    return m === 0 ? `${h} h` : `${h}h ${m}m`;
  }

  if (min < 60) return formatUnit(min, 'minute', locale);
  const hours = Math.floor(min / 60);
  const minutes = min % 60;
  const formattedHours = formatUnit(hours, 'hour', locale);
  return minutes === 0
    ? formattedHours
    : `${formattedHours} ${formatUnit(minutes, 'minute', locale)}`;
}

export function formatPrepTime(low: number, high: number, locale?: Locale): string {
  if (isLegacyEnglish(locale)) return `${low}–${high} min`;

  const formattedLow = new Intl.NumberFormat(localeIdentifier(locale)).format(low);
  return `${formattedLow}–${formatUnit(high, 'minute', locale)}`;
}

export function formatShortCode(id: string): string {
  return id.slice(0, 8).toUpperCase();
}

export function pluralize(n: number, singular: string, plural?: string): string {
  return n === 1 ? singular : (plural ?? `${singular}s`);
}

export function formatTime(d: Date, locale?: Locale): string {
  if (!isLegacyEnglish(locale)) {
    return new Intl.DateTimeFormat(localeIdentifier(locale), {
      hour: 'numeric',
      minute: '2-digit',
    }).format(d);
  }

  const h = d.getHours();
  const m = d.getMinutes();
  const ampm = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${m.toString().padStart(2, '0')} ${ampm}`;
}
