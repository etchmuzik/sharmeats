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
