import { describe, expect, it } from 'vitest';
import {
  CRITICAL_S,
  FALLBACK_WINDOW_S,
  WARNING_S,
  barFraction,
  formatCountdown,
  hasUsableExpiry,
  isExpired,
  nextOfferWindow,
  parseExpiry,
  secondsRemaining,
  urgencyOf,
} from './offerUrgency';

const NOW = Date.UTC(2026, 6, 29, 12, 0, 0);
const at = (offsetSeconds: number) => new Date(NOW + offsetSeconds * 1000).toISOString();

describe('parseExpiry — malformed timestamps must fail closed', () => {
  it('parses a valid ISO timestamp', () => {
    expect(parseExpiry(at(30))).toBe(NOW + 30_000);
  });

  it('returns null for null/empty rather than NaN', () => {
    expect(parseExpiry(null)).toBeNull();
    expect(parseExpiry('')).toBeNull();
  });

  // The regression. `new Date('not-a-date').getTime()` is NaN, and NaN is not
  // === null, so before this collapse a malformed expiry produced an offer that
  // rendered "NaN:NaN", read as calm, never auto-dismissed, and kept Accept
  // enabled on an offer dispatch had already swept server-side.
  it('collapses an unparseable timestamp to null, not NaN', () => {
    for (const bad of ['not-a-date', '2026-13-45T99:99:99Z', 'null', '{}']) {
      expect(parseExpiry(bad), `input: ${bad}`).toBeNull();
    }
  });
});

describe('hasUsableExpiry — an offer without a deadline is broken, not calm', () => {
  it('accepts a real timestamp', () => {
    expect(hasUsableExpiry(at(45))).toBe(true);
    // Already past is still USABLE: it says, definitively, "expired".
    expect(hasUsableExpiry(at(-45))).toBe(true);
  });

  // The production case: three assignments were sitting in `offered` with a
  // NULL offer_expires_at, and the card rendered them with no countdown, no
  // auto-dismiss and a live Accept button — i.e. valid forever. Two were on
  // CANCELLED orders, and accepting one takes the driver out of the pool for a
  // job that can never be delivered.
  it('rejects null and unparseable expiries', () => {
    expect(hasUsableExpiry(null)).toBe(false);
    expect(hasUsableExpiry('')).toBe(false);
    expect(hasUsableExpiry('not-a-date')).toBe(false);
  });
});

describe('secondsRemaining', () => {
  it('counts down and clamps at zero', () => {
    expect(secondsRemaining(NOW + 45_000, NOW)).toBe(45);
    expect(secondsRemaining(NOW + 500, NOW)).toBe(1); // rounds
    expect(secondsRemaining(NOW - 60_000, NOW)).toBe(0); // never negative
  });

  it('passes null through', () => {
    expect(secondsRemaining(null, NOW)).toBeNull();
  });
});

describe('urgencyOf', () => {
  it('escalates calm -> warning -> critical at the boundaries', () => {
    expect(urgencyOf(45)).toBe('calm');
    expect(urgencyOf(WARNING_S + 1)).toBe('calm');
    expect(urgencyOf(WARNING_S)).toBe('warning');
    expect(urgencyOf(CRITICAL_S + 1)).toBe('warning');
    expect(urgencyOf(CRITICAL_S)).toBe('critical');
    expect(urgencyOf(0)).toBe('critical');
  });

  it('treats an absent countdown as calm, not critical', () => {
    // A legacy row with no expiry should not scream at the driver.
    expect(urgencyOf(null)).toBe('calm');
  });
});

describe('isExpired', () => {
  it('is true only at or below zero', () => {
    expect(isExpired(1)).toBe(false);
    expect(isExpired(0)).toBe(true);
  });

  it('is false when there is no countdown at all', () => {
    expect(isExpired(null)).toBe(false);
  });
});

describe('nextOfferWindow — self-calibrating bar scale', () => {
  // The bug: ASSUMED_WINDOW_S was hardcoded to 60 while the server default
  // (platform_settings.dispatch_offer_ttl_seconds, mig 025) is 45. The bar
  // therefore started at 45/60 = 75% and never once showed full.
  it('adopts a real window larger than the fallback', () => {
    expect(nextOfferWindow(FALLBACK_WINDOW_S, 60)).toBe(60);
    expect(nextOfferWindow(FALLBACK_WINDOW_S, 120)).toBe(120);
  });

  it('never shrinks, so the bar cannot jump backwards mid-countdown', () => {
    let w = FALLBACK_WINDOW_S;
    for (const s of [45, 44, 30, 12, 3, 0]) w = nextOfferWindow(w, s);
    expect(w).toBe(FALLBACK_WINDOW_S);
  });

  it('ignores a null tick', () => {
    expect(nextOfferWindow(45, null)).toBe(45);
  });
});

describe('barFraction — must always be finite', () => {
  it('is full at the start of the window and empty at expiry', () => {
    expect(barFraction(45, 45)).toBe(1);
    expect(barFraction(0, 45)).toBe(0);
  });

  it('shows the true remaining fraction once calibrated', () => {
    // At 45s left of a 45s window the bar is full — the old hardcoded 60
    // rendered this same moment at 75%.
    expect(barFraction(45, nextOfferWindow(FALLBACK_WINDOW_S, 45))).toBe(1);
    expect(barFraction(30, 60)).toBe(0.5);
  });

  it('never yields NaN, which would reach Yoga as a "NaN%" width', () => {
    for (const [s, w] of [
      [null, 45],
      [10, 0],
      [10, Number.NaN],
      [10, Number.POSITIVE_INFINITY],
    ] as [number | null, number][]) {
      const f = barFraction(s, w);
      expect(Number.isFinite(f), `seconds=${s} window=${w}`).toBe(true);
      expect(f).toBeGreaterThanOrEqual(0);
      expect(f).toBeLessThanOrEqual(1);
    }
  });
});

describe('formatCountdown', () => {
  it('formats as m:ss with a zero-padded seconds field', () => {
    expect(formatCountdown(0)).toBe('0:00');
    expect(formatCountdown(9)).toBe('0:09');
    expect(formatCountdown(45)).toBe('0:45');
    expect(formatCountdown(90)).toBe('1:30');
  });

  it('degrades to 0:00 rather than rendering "NaN:NaN"', () => {
    expect(formatCountdown(Number.NaN)).toBe('0:00');
    expect(formatCountdown(-5)).toBe('0:00');
  });
});

describe('end-to-end: a malformed expiry cannot produce an acceptable offer', () => {
  it('reads as no-countdown rather than a calm, live, never-expiring card', () => {
    const seconds = secondsRemaining(parseExpiry('not-a-date'), NOW);
    expect(seconds).toBeNull();
    expect(isExpired(seconds)).toBe(false); // no countdown to have run out
    expect(urgencyOf(seconds)).toBe('calm');
    expect(barFraction(seconds, FALLBACK_WINDOW_S)).toBe(1);
    // Crucially: nothing here is NaN, so no "NaN:NaN" pill and no "NaN%" width.
    expect(formatCountdown(seconds ?? 0)).toBe('0:00');
  });
});
