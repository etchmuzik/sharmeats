export const AUTHORITATIVE_PING_INTERVAL_MS = 25_000;

export interface RawLocationFix {
  timestamp: number;
  coords: {
    latitude: number;
    longitude: number;
    heading?: number | null;
  };
}

export interface DriverLocationPayload {
  lat: number;
  lng: number;
  heading?: number;
  at: number;
}

function isValidFix(fix: RawLocationFix): boolean {
  const { latitude, longitude } = fix.coords;
  return (
    Number.isFinite(fix.timestamp) &&
    Number.isFinite(latitude) &&
    Number.isFinite(longitude) &&
    latitude >= -90 &&
    latitude <= 90 &&
    longitude >= -180 &&
    longitude <= 180
  );
}

/** Android/iOS may deliver several deferred fixes at once; publish only the newest valid one. */
export function latestValidFix(fixes: RawLocationFix[]): RawLocationFix | null {
  return fixes
    .filter(isValidFix)
    .reduce<RawLocationFix | null>(
      (latest, candidate) =>
        latest === null || candidate.timestamp > latest.timestamp ? candidate : latest,
      null,
    );
}

export function authoritativePingDue(lastPingAt: number | null, now: number): boolean {
  return lastPingAt === null || now - lastPingAt >= AUTHORITATIVE_PING_INTERVAL_MS;
}

export function toBroadcastPayload(fix: RawLocationFix): DriverLocationPayload {
  const rawHeading = fix.coords.heading;
  const heading =
    typeof rawHeading === 'number' && Number.isFinite(rawHeading) && rawHeading >= 0
      ? ((rawHeading % 360) + 360) % 360
      : undefined;
  return {
    lat: fix.coords.latitude,
    lng: fix.coords.longitude,
    ...(heading === undefined ? {} : { heading }),
    at: fix.timestamp,
  };
}
