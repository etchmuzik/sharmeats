import { describe, expect, it } from 'vitest';
import {
  authoritativePingDue,
  latestValidFix,
  toBroadcastPayload,
  type RawLocationFix,
} from './locationCore';

const fix = (
  latitude: number,
  longitude: number,
  timestamp: number,
  heading: number | null = null,
): RawLocationFix => ({
  timestamp,
  coords: { latitude, longitude, heading },
});

describe('driver background-location core', () => {
  it('selects the newest valid fix from an OS-delivered batch', () => {
    expect(
      latestValidFix([
        fix(27.9, 34.3, 100),
        fix(Number.NaN, 34.4, 300),
        fix(27.91, 34.31, 200, 145),
      ]),
    ).toEqual(fix(27.91, 34.31, 200, 145));
  });

  it('rejects impossible coordinates so they never reach Realtime or PostGIS', () => {
    expect(latestValidFix([fix(91, 34.3, 100), fix(27.9, 181, 200)])).toBeNull();
  });

  it('keeps the authoritative database write on the 25-second throttle', () => {
    expect(authoritativePingDue(null, 30_000)).toBe(true);
    expect(authoritativePingDue(10_000, 34_999)).toBe(false);
    expect(authoritativePingDue(10_000, 35_000)).toBe(true);
  });

  it('normalizes heading and preserves the fix timestamp for stale-marker detection', () => {
    expect(toBroadcastPayload(fix(27.9, 34.3, 123_456, -1))).toEqual({
      lat: 27.9,
      lng: 34.3,
      at: 123_456,
    });
    expect(toBroadcastPayload(fix(27.9, 34.3, 123_456, 361))).toEqual({
      lat: 27.9,
      lng: 34.3,
      heading: 1,
      at: 123_456,
    });
  });
});
