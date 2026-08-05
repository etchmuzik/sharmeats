import { describe, it, expect } from 'vitest';
import {
  DEFAULT_NOTIFICATION_PREFS,
  isQuietHour,
  marketingSuppressed,
  formatQuietWindow,
} from './notificationPrefs';
import type { NotificationPrefs } from '../data/types';

const prefs = (over: Partial<NotificationPrefs> = {}): NotificationPrefs => ({
  ...DEFAULT_NOTIFICATION_PREFS,
  ...over,
});

describe('notification defaults — marketing is opt-IN', () => {
  // If this test ever fails, someone has flipped marketing to opt-out and every
  // existing customer would start receiving promotions they never agreed to.
  it('defaults marketing OFF', () => {
    expect(DEFAULT_NOTIFICATION_PREFS.marketing).toBe(false);
  });
  it('defaults transactional ON', () => {
    expect(DEFAULT_NOTIFICATION_PREFS.transactional).toBe(true);
  });
  it('defaults to no quiet window', () => {
    expect(DEFAULT_NOTIFICATION_PREFS.quietHoursStart).toBeNull();
    expect(DEFAULT_NOTIFICATION_PREFS.quietHoursEnd).toBeNull();
  });
});

describe('isQuietHour — matches public.in_quiet_hours', () => {
  it('is never quiet when no window is set', () => {
    expect(isQuietHour(3, null, null)).toBe(false);
  });
  it('treats the window as half-open [start, end)', () => {
    expect(isQuietHour(9, 9, 17)).toBe(true);
    expect(isQuietHour(16, 9, 17)).toBe(true);
    expect(isQuietHour(17, 9, 17)).toBe(false);
    expect(isQuietHour(8, 9, 17)).toBe(false);
  });
  it('wraps midnight when start > end', () => {
    expect(isQuietHour(23, 22, 7)).toBe(true);
    expect(isQuietHour(3, 22, 7)).toBe(true);
    expect(isQuietHour(22, 22, 7)).toBe(true);
    expect(isQuietHour(7, 22, 7)).toBe(false);
    expect(isQuietHour(12, 22, 7)).toBe(false);
  });
  it('treats start === end as zero-width, not all-day', () => {
    // The opposite reading would silently mute every promotion forever.
    for (const h of [0, 6, 12, 23]) expect(isQuietHour(h, 9, 9)).toBe(false);
  });
});

describe('marketingSuppressed', () => {
  it('suppresses when marketing is off, regardless of hour', () => {
    expect(marketingSuppressed(prefs({ marketing: false }), 12)).toBe(true);
  });
  it('allows when opted in and outside quiet hours', () => {
    expect(marketingSuppressed(prefs({ marketing: true }), 12)).toBe(false);
  });
  it('suppresses when opted in but inside quiet hours', () => {
    const p = prefs({ marketing: true, quietHoursStart: 22, quietHoursEnd: 8 });
    expect(marketingSuppressed(p, 2)).toBe(true);
    expect(marketingSuppressed(p, 13)).toBe(false);
  });
  it('ignores the transactional switch entirely', () => {
    // Order updates must never be gated by the marketing rules.
    const p = prefs({ marketing: true, transactional: false });
    expect(marketingSuppressed(p, 12)).toBe(false);
  });
});

describe('formatQuietWindow', () => {
  it('returns null with no window', () => {
    expect(formatQuietWindow(prefs())).toBeNull();
  });
  it('zero-pads both hours', () => {
    expect(formatQuietWindow(prefs({ quietHoursStart: 8, quietHoursEnd: 9 }))).toBe('08:00 – 09:00');
    expect(formatQuietWindow(prefs({ quietHoursStart: 22, quietHoursEnd: 8 }))).toBe('22:00 – 08:00');
  });
  it('uses the selected locale for clock digits', () => {
    expect(formatQuietWindow(prefs({ quietHoursStart: 22, quietHoursEnd: 8 }), 'ar')).toBe(
      '٢٢:٠٠ – ٠٨:٠٠',
    );
  });
});
