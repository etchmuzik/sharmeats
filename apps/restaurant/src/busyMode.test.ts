import { describe, expect, it } from 'vitest';
import {
  BUSY_DURATION_MINUTES,
  BUSY_PRESET_MINUTES,
  busyMinutesRemaining,
  isBusyActive,
  summarizeBusy,
} from './busyMode';

const NOW = Date.parse('2026-07-31T20:00:00.000Z');
const MINUTE = 60_000;
const at = (offsetMinutes: number) => new Date(NOW + offsetMinutes * MINUTE).toISOString();

describe('busy-mode presets stay inside the RPC bounds', () => {
  it('offers only bumps migration 186 will accept (5..60)', () => {
    for (const minutes of BUSY_PRESET_MINUTES) {
      expect(minutes).toBeGreaterThanOrEqual(5);
      expect(minutes).toBeLessThanOrEqual(60);
    }
  });

  it('uses a duration inside the RPC bound (15..240)', () => {
    expect(BUSY_DURATION_MINUTES).toBeGreaterThanOrEqual(15);
    expect(BUSY_DURATION_MINUTES).toBeLessThanOrEqual(240);
  });
});

describe('busy-mode expiry', () => {
  it('applies only while busy_until is in the future, mirroring the server', () => {
    expect(isBusyActive(at(30), NOW)).toBe(true);
    expect(isBusyActive(at(-1), NOW)).toBe(false);
    expect(isBusyActive(null, NOW)).toBe(false);
    expect(isBusyActive('not-a-date', NOW)).toBe(false);
  });

  it('rounds the remaining window up so it never reads 0 while still applying', () => {
    expect(busyMinutesRemaining(at(60), NOW)).toBe(60);
    expect(busyMinutesRemaining(at(0.2), NOW)).toBe(1);
    expect(busyMinutesRemaining(at(-5), NOW)).toBe(0);
  });
});

describe('collapsing busy mode across a cloud kitchen', () => {
  it('reports nothing when no brand is busy', () => {
    expect(
      summarizeBusy(
        [
          { busyUntil: null, busyExtraMinutes: 0 },
          { busyUntil: at(-10), busyExtraMinutes: 20 },
        ],
        NOW,
      ),
    ).toEqual({ active: false, extraMinutes: 0, minutesRemaining: 0 });
  });

  it('never understates how far behind the pass is', () => {
    // One brand may have been set separately from the web dashboard. Reporting
    // the largest live bump keeps the header honest rather than optimistic.
    expect(
      summarizeBusy(
        [
          { busyUntil: at(10), busyExtraMinutes: 10 },
          { busyUntil: at(45), busyExtraMinutes: 30 },
          { busyUntil: at(-5), busyExtraMinutes: 60 },
        ],
        NOW,
      ),
    ).toEqual({ active: true, extraMinutes: 30, minutesRemaining: 45 });
  });
});
