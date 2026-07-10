import { describe, it, expect } from 'vitest';
import {
  CAMERA_REFIT_THRESHOLD_M,
  isDriverLocationStale,
  metersBetween,
  STALE_THRESHOLD_MS,
  vehicleIconName,
} from './tracking';

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

describe('metersBetween — camera-refit movement gate', () => {
  const sharm = { lat: 27.9158, lng: 34.33 };

  it('returns 0 for the same point', () => {
    expect(metersBetween(sharm, sharm)).toBe(0);
  });

  it('measures ~111m per 0.001° of latitude', () => {
    const north = { lat: sharm.lat + 0.001, lng: sharm.lng };
    const d = metersBetween(sharm, north);
    expect(d).toBeGreaterThan(105);
    expect(d).toBeLessThan(117);
  });

  it('is symmetric', () => {
    const b = { lat: sharm.lat + 0.0021, lng: sharm.lng - 0.0017 };
    expect(metersBetween(sharm, b)).toBeCloseTo(metersBetween(b, sharm), 6);
  });

  it('GPS jitter (~10m) stays under the refit threshold', () => {
    const jitter = { lat: sharm.lat + 0.00009, lng: sharm.lng };
    expect(metersBetween(sharm, jitter)).toBeLessThan(CAMERA_REFIT_THRESHOLD_M);
  });

  it('a real move (~200m) clears the refit threshold', () => {
    const moved = { lat: sharm.lat + 0.0018, lng: sharm.lng };
    expect(metersBetween(sharm, moved)).toBeGreaterThan(CAMERA_REFIT_THRESHOLD_M);
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
