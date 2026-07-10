import type { IconName } from '../components/Icon';

/**
 * How long a live driver fix can go without an update before the tracking
 * screen tells the customer we've lost the live feed. The driver's own ping
 * is throttled to ~25s; 45s gives roughly one missed interval of margin
 * before flagging staleness, so a driver briefly stopped (red light, another
 * drop-off) doesn't trigger a false "reconnecting" note.
 */
export const STALE_THRESHOLD_MS = 45_000;

/** Whether a driver location fix (by its `at` timestamp) is too old to trust. */
export function isDriverLocationStale(
  lastFixAt: number,
  now: number,
  thresholdMs: number = STALE_THRESHOLD_MS,
): boolean {
  return now - lastFixAt >= thresholdMs;
}

/** Maps a rider's vehicle type to the map-marker IconName that represents it. */
export function vehicleIconName(vehicle: 'scooter' | 'motorbike' | 'bicycle' | 'car'): IconName {
  return vehicle;
}

/**
 * The tracking map only re-runs its animated camera fit once the driver has
 * moved at least this far from the last fitted position. Location broadcasts
 * arrive every ~5s regardless of movement (GPS jitter included), and
 * re-fitting on every ping made the map pan/zoom continuously.
 */
export const CAMERA_REFIT_THRESHOLD_M = 50;

/**
 * Approximate ground distance in meters between two lat/lng points
 * (equirectangular projection — accurate to well under 1% at sub-km scales,
 * which is all the camera-refit threshold needs).
 */
export function metersBetween(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const R = 6371000;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const x = dLng * Math.cos(((a.lat + b.lat) * Math.PI) / 360);
  return R * Math.sqrt(dLat * dLat + x * x);
}
