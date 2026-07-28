/**
 * Pure escalation logic for a delivery offer, split out of `OfferCard` so it can
 * be tested without rendering. The component owns presentation; this owns the
 * decisions that make an offer look urgent.
 *
 * Every function here fails CLOSED: an unparseable or missing expiry is treated
 * as "no countdown", never as "plenty of time". The failure that actually cost
 * money was the opposite — a NaN expiry read as calm, kept Accept enabled, and
 * let a driver accept an offer dispatch had already swept.
 */

/** Seconds at/below which the offer is critical (red, pulsing, haptic fired). */
export const CRITICAL_S = 10;
/** Seconds at/below which the offer is a warning (amber). */
export const WARNING_S = 20;
/**
 * Fallback window for scaling the countdown bar, used until a real tick is seen.
 * Matches `platform_settings.dispatch_offer_ttl_seconds` (mig 025), which the
 * client cannot read — see `nextOfferWindow` for why that is survivable.
 */
export const FALLBACK_WINDOW_S = 45;

export type Urgency = 'calm' | 'warning' | 'critical';

/**
 * Milliseconds-since-epoch for an expiry timestamp, or null when there is no
 * usable one.
 *
 * `new Date('nonsense').getTime()` is NaN, NOT null — so without this collapse
 * a malformed timestamp slips past every `=== null` guard downstream: NaN <= 0
 * is false, so the offer never expires, never auto-dismisses, and keeps Accept
 * live indefinitely.
 */
export function parseExpiry(expiresAt: string | null): number | null {
  if (!expiresAt) return null;
  const ms = new Date(expiresAt).getTime();
  return Number.isNaN(ms) ? null : ms;
}

/** Whole seconds remaining until `targetMs`, clamped at 0. Null passes through. */
export function secondsRemaining(targetMs: number | null, nowMs: number): number | null {
  if (targetMs === null) return null;
  return Math.max(0, Math.round((targetMs - nowMs) / 1000));
}

export function urgencyOf(seconds: number | null): Urgency {
  if (seconds === null) return 'calm';
  if (seconds <= CRITICAL_S) return 'critical';
  if (seconds <= WARNING_S) return 'warning';
  return 'calm';
}

/** An offer with a countdown that has run out. A null countdown is not expired. */
export function isExpired(seconds: number | null): boolean {
  return seconds !== null && seconds <= 0;
}

/**
 * Ratchets the assumed offer window upward from observed values.
 *
 * The real window is a server setting the client never reads. Rather than
 * hardcode a guess — 60 against a real 45 starts the bar at 75% and it never
 * shows full; 60 against a raised 120 pins it at 100% for the first minute —
 * calibrate from the offer: the largest remaining value ever seen is, by
 * definition, at least the true window. Monotonic so the bar cannot jump
 * backwards mid-countdown.
 */
export function nextOfferWindow(current: number, seconds: number | null): number {
  if (seconds === null) return current;
  return seconds > current ? seconds : current;
}

/** Remaining fraction (0..1) for the countdown bar. Always finite. */
export function barFraction(seconds: number | null, windowS: number): number {
  if (seconds === null) return 1;
  if (!Number.isFinite(windowS) || windowS <= 0) return 1;
  return Math.max(0, Math.min(1, seconds / windowS));
}

/** Format seconds as m:ss, e.g. 42 -> "0:42", 90 -> "1:30". */
export function formatCountdown(totalSeconds: number): string {
  if (!Number.isFinite(totalSeconds) || totalSeconds < 0) return '0:00';
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}
