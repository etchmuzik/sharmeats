import { describe, it, expect } from 'vitest';
import { isDriverLocationStale, STALE_THRESHOLD_MS, vehicleIconName } from './tracking';

describe('isDriverLocationStale — live-marker freshness check', () => {
  it('returns false when the fix is fresh (0ms old)', () => {
    expect(isDriverLocationStale(1000, 1000)).toBe(false);
  });

  it('returns false just under the threshold', () => {
    expect(isDriverLocationStale(1000, 1000 + STALE_THRESHOLD_MS - 1)).toBe(false);
  });

  it('returns true at exactly the threshold', () => {
    expect(isDriverLocationStale(1000, 1000 + STALE_THRESHOLD_MS)).toBe(true);
  });

  it('returns true well past the threshold', () => {
    expect(isDriverLocationStale(1000, 1000 + STALE_THRESHOLD_MS + 60_000)).toBe(true);
  });

  it('honors a custom threshold override', () => {
    expect(isDriverLocationStale(1000, 11_000, 5_000)).toBe(true);
    expect(isDriverLocationStale(1000, 4_000, 5_000)).toBe(false);
  });
});

describe('vehicleIconName — maps rider vehicle to an IconName', () => {
  it('maps scooter', () => {
    expect(vehicleIconName('scooter')).toBe('scooter');
  });

  it('maps motorbike', () => {
    expect(vehicleIconName('motorbike')).toBe('motorbike');
  });

  it('maps bicycle', () => {
    expect(vehicleIconName('bicycle')).toBe('bicycle');
  });

  it('maps car', () => {
    expect(vehicleIconName('car')).toBe('car');
  });
});
