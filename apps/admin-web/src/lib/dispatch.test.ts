import { describe, it, expect } from 'vitest';
import {
  isPingStale,
  lastSeenLabel,
  isDispatchable,
  DEFAULT_MAX_PING_AGE_SECONDS,
} from './dispatch';

// A fixed "now" so these never depend on the wall clock.
const NOW = Date.parse('2026-07-31T12:00:00Z');
const agoSeconds = (s: number) => new Date(NOW - s * 1000).toISOString();

describe('isPingStale', () => {
  it('accepts a ping inside the window', () => {
    expect(isPingStale(agoSeconds(60), NOW)).toBe(false);
    expect(isPingStale(agoSeconds(299), NOW)).toBe(false);
  });

  it('rejects a ping past the window', () => {
    expect(isPingStale(agoSeconds(301), NOW)).toBe(true);
    expect(isPingStale(agoSeconds(3600), NOW)).toBe(true);
  });

  it('treats exactly the boundary as fresh, matching the SQL `>` comparison', () => {
    // Migration 201: last_ping_at > now() - interval. Equal is not greater, but
    // the SQL compares the timestamp while this compares the age, so the
    // inclusive side lands here. Asserted so a future edit to `>=` is a visible
    // behaviour change rather than a silent one.
    expect(isPingStale(agoSeconds(300), NOW)).toBe(false);
  });

  it('FAILS CLOSED on a driver that has never pinged', () => {
    // The whole point: absence of evidence is not evidence of presence.
    expect(isPingStale(null, NOW)).toBe(true);
    expect(isPingStale(undefined, NOW)).toBe(true);
    expect(isPingStale('', NOW)).toBe(true);
  });

  it('FAILS CLOSED on an unparseable timestamp', () => {
    expect(isPingStale('not a date', NOW)).toBe(true);
  });

  it('honours a custom window from platform_settings', () => {
    expect(isPingStale(agoSeconds(600), NOW, 900)).toBe(false);
    expect(isPingStale(agoSeconds(600), NOW, 300)).toBe(true);
  });

  it('reproduces the 2026-07-31 incident drivers', () => {
    // Ahmed Hassan / Mostafa Ali: status='online', last ping 2026-06-04.
    expect(isPingStale('2026-06-04T09:38:00Z', NOW)).toBe(true);
  });

  it('defaults to the migration 201 window', () => {
    expect(DEFAULT_MAX_PING_AGE_SECONDS).toBe(300);
  });
});

describe('lastSeenLabel', () => {
  it.each([
    [30, '30s ago'],
    [90, '1m ago'],
    [3600, '1h ago'],
    [7200, '2h ago'],
    [86_400, '1d ago'],
  ])('formats %is as %s', (seconds, expected) => {
    expect(lastSeenLabel(agoSeconds(seconds), NOW)).toBe(expected);
  });

  it('says so when there is no ping at all', () => {
    expect(lastSeenLabel(null, NOW)).toBe('never seen');
    expect(lastSeenLabel('nonsense', NOW)).toBe('never seen');
  });

  it('clamps a future timestamp rather than rendering negative time', () => {
    // Driver phone clock ahead of the server — real, and "-3m ago" looks broken.
    const future = new Date(NOW + 180_000).toISOString();
    expect(lastSeenLabel(future, NOW)).toBe('0s ago');
  });

  it('describes the incident drivers in a way a dispatcher can act on', () => {
    expect(lastSeenLabel('2026-06-04T09:38:00Z', NOW)).toBe('57d ago');
  });
});

describe('isDispatchable', () => {
  const fresh = { status: 'online' as const, is_verified: true, last_ping_at: agoSeconds(30) };

  it('accepts an online, verified driver with a fresh ping', () => {
    expect(isDispatchable(fresh, NOW)).toBe(true);
  });

  it('rejects a stale ping even when everything else looks right', () => {
    // This is the case the dispatch board used to allow.
    expect(isDispatchable({ ...fresh, last_ping_at: agoSeconds(7200) }, NOW)).toBe(false);
  });

  it('rejects unverified, offline and on_job as before', () => {
    expect(isDispatchable({ ...fresh, is_verified: false }, NOW)).toBe(false);
    expect(isDispatchable({ ...fresh, status: 'offline' }, NOW)).toBe(false);
    expect(isDispatchable({ ...fresh, status: 'on_job' }, NOW)).toBe(false);
  });

  it('rejects a driver that has never pinged', () => {
    expect(isDispatchable({ ...fresh, last_ping_at: null }, NOW)).toBe(false);
  });
});
