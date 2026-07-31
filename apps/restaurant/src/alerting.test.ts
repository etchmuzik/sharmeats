import { describe, expect, it } from 'vitest';
import {
  MUTE_DURATION_MINUTES,
  alertingIsDegraded,
  formatWait,
  isMuteActive,
  muteMinutesRemaining,
  muteUntilFrom,
  oldestWaitSeconds,
} from './alerting';

const NOW = Date.parse('2026-07-31T20:00:00.000Z');
const MINUTE = 60_000;

describe('self-expiring chime mute', () => {
  it('mutes for a bounded window rather than forever', () => {
    const until = muteUntilFrom(NOW);
    expect(Date.parse(until) - NOW).toBe(MUTE_DURATION_MINUTES * MINUTE);
    expect(isMuteActive(until, NOW)).toBe(true);
    expect(isMuteActive(until, NOW + MUTE_DURATION_MINUTES * MINUTE)).toBe(false);
  });

  it('fails LOUD on a missing or unparseable stored value', () => {
    // A permanently silent kitchen is the worse failure, so anything we cannot
    // read as a future timestamp means "sound is on".
    expect(isMuteActive(null, NOW)).toBe(false);
    expect(isMuteActive('1', NOW)).toBe(false);
    expect(isMuteActive('not-a-date', NOW)).toBe(false);
  });

  it('counts the remaining minutes up, never down to a misleading zero', () => {
    const until = muteUntilFrom(NOW, 30);
    expect(muteMinutesRemaining(until, NOW)).toBe(30);
    expect(muteMinutesRemaining(until, NOW + 29.5 * MINUTE)).toBe(1);
    expect(muteMinutesRemaining(until, NOW + 30 * MINUTE)).toBe(0);
    expect(muteMinutesRemaining(null, NOW)).toBe(0);
  });
});

describe('alerting degradation', () => {
  it('flags a denied permission, a mute, or a dead feed', () => {
    expect(alertingIsDegraded('denied', false, true)).toBe(true);
    expect(alertingIsDegraded('granted', true, true)).toBe(true);
    expect(alertingIsDegraded('granted', false, false)).toBe(true);
  });

  it('stays quiet when alerting is healthy, unresolved, or not applicable', () => {
    expect(alertingIsDegraded('granted', false, true)).toBe(false);
    // Nagging a simulator or a not-yet-resolved check trains staff to ignore
    // the banner on the day it is telling the truth.
    expect(alertingIsDegraded('unknown', false, true)).toBe(false);
    expect(alertingIsDegraded('unsupported', false, true)).toBe(false);
  });
});

describe('wait formatting for the unacknowledged banner', () => {
  it('renders m:ss with a padded seconds field', () => {
    expect(formatWait(0)).toBe('0:00');
    expect(formatWait(74)).toBe('1:14');
    expect(formatWait(600)).toBe('10:00');
  });

  it('never renders NaN at a kitchen', () => {
    expect(formatWait(Number.NaN)).toBe('0:00');
    expect(formatWait(-5)).toBe('0:00');
  });

  it('reports the WORST wait and skips rows it cannot parse', () => {
    const placed = [
      new Date(NOW - 30_000).toISOString(),
      new Date(NOW - 300_000).toISOString(),
      'garbage',
    ];
    // 'garbage' must not be read as epoch-0 (absurdly old) nor as 0 seconds
    // (which would understate the number staff are meant to react to).
    expect(oldestWaitSeconds(placed, NOW)).toBe(300);
    expect(oldestWaitSeconds([], NOW)).toBe(0);
    expect(oldestWaitSeconds(['garbage'], NOW)).toBe(0);
  });
});
