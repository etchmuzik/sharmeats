/**
 * Notification-consent rules, mirrored from migration 138.
 *
 * The AUTHORITY is the database: `marketing_allowed()` decides whether a push
 * is sent, and `send_push_campaign` filters every segment through it. Nothing
 * here can grant consent — this module exists so the UI can *describe* the
 * user's setting truthfully (and so the rules have tests, since the SQL side
 * cannot be reached from vitest).
 *
 * Keep these in lockstep with mig 138. If they ever disagree, the database
 * wins and the UI is the thing that is lying.
 */
import type { NotificationPrefs } from '../data/types';
import { formatLocalizedNumber } from '../i18n/interpolation';
import type { Locale } from '../store/session';

/** Server-side defaults from mig 138: transactional on, marketing OPT-IN. */
export const DEFAULT_NOTIFICATION_PREFS: NotificationPrefs = {
  transactional: true,
  marketing: false,
  quietHoursStart: null,
  quietHoursEnd: null,
  timezone: 'Africa/Cairo',
};

/**
 * Whether `hour` (0-23, local clock) falls inside a quiet window.
 * Mirrors public.in_quiet_hours: the window is [start, end), and a window whose
 * start is after its end wraps midnight (22 -> 7 means 22:00-06:59).
 * A start equal to end is zero-width, NOT all-day.
 */
export function isQuietHour(hour: number, start: number | null, end: number | null): boolean {
  if (start === null || end === null) return false;
  if (start === end) return false;
  if (start < end) return hour >= start && hour < end;
  return hour >= start || hour < end;
}

/**
 * Whether a MARKETING push would currently be suppressed for these prefs.
 * Transactional pushes are never suppressed — an order update must not wait
 * for morning — so this deliberately ignores `transactional`.
 */
export function marketingSuppressed(prefs: NotificationPrefs, hour: number): boolean {
  if (!prefs.marketing) return true;
  return isQuietHour(hour, prefs.quietHoursStart, prefs.quietHoursEnd);
}

/** "22:00 – 08:00", or null when no window is set. */
export function formatQuietWindow(prefs: NotificationPrefs, locale: Locale = 'en'): string | null {
  if (prefs.quietHoursStart === null || prefs.quietHoursEnd === null) return null;
  const pad = (hour: number) => formatLocalizedNumber(hour, locale, { minimumIntegerDigits: 2 });
  const minutes = formatLocalizedNumber(0, locale, { minimumIntegerDigits: 2 });
  return `${pad(prefs.quietHoursStart)}:${minutes} – ${pad(prefs.quietHoursEnd)}:${minutes}`;
}
