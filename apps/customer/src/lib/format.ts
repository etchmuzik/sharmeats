import { useSession } from '../store/session';

export function formatEgp(value: number): string {
  return `EGP ${Math.round(value).toLocaleString('en-US')}`;
}

export function formatKm(meters: number): string {
  if (meters < 950) return `${Math.round(meters / 10) * 10} m`;
  return `${(meters / 1000).toFixed(1)} km`;
}

export function formatMinutes(min: number): string {
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m === 0 ? `${h} h` : `${h}h ${m}m`;
}

export function formatPrepTime(low: number, high: number): string {
  return `${low}–${high} min`;
}

export function formatShortCode(id: string): string {
  return id.slice(0, 8).toUpperCase();
}

export function pluralize(n: number, singular: string, plural?: string): string {
  return n === 1 ? singular : (plural ?? `${singular}s`);
}

/**
 * BCP-47 tag per app locale. The app's `Locale` codes are bare languages, and a
 * bare 'ar' resolves to a region whose clock conventions are not Egypt's, so the
 * region is pinned explicitly.
 */
const TIME_LOCALE_TAGS: Record<string, string> = {
  en: 'en-US',
  ar: 'ar-EG',
  ru: 'ru-RU',
  it: 'it-IT',
  de: 'de-DE',
};

/** Last-resort 12-hour English clock, used only if Intl is unavailable. */
function fallbackTime(d: Date): string {
  const h = d.getHours();
  const m = d.getMinutes();
  const ampm = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${m.toString().padStart(2, '0')} ${ampm}`;
}

/**
 * A wall-clock time in a specific locale's own convention.
 *
 * This used to be hardcoded 12-hour English AM/PM in ALL FIVE locales, so a
 * Russian, Italian or German customer read "7:40 PM" where their whole OS says
 * "19:40", and an Arabic customer got Latin digits and a Latin meridiem inside
 * an RTL sentence. Every clock time the app shows — tracking ETA, the SLA
 * promise, scheduled slots, order history — goes through here.
 *
 * `toLocaleTimeString` is wrapped because Hermes builds without full ICU fall
 * back to a stub that ignores the locale (and, on some older builds, throws).
 * An unformatted time is worse than the old behaviour, so anything unexpected
 * degrades to the previous English clock rather than rendering an empty string.
 */
export function formatTimeIn(locale: string, d: Date): string {
  if (Number.isNaN(d.getTime())) return '—';
  try {
    const out = d.toLocaleTimeString(TIME_LOCALE_TAGS[locale] ?? 'en-US', {
      hour: 'numeric',
      minute: '2-digit',
    });
    // A stub Intl can hand back the full date/time string (or nothing useful).
    // Only accept something that looks like a clock time.
    if (out && out.length <= 12) return out;
  } catch {
    // fall through to the English clock below
  }
  return fallbackTime(d);
}

/**
 * Locale-aware clock time for the CURRENT session language.
 *
 * Reads the live locale from the session store rather than taking it as an
 * argument, exactly as `i18n.t()` does, so every existing call site formats
 * correctly without threading a locale through the tree.
 */
export function formatTime(d: Date): string {
  return formatTimeIn(useSession.getState().locale, d);
}
