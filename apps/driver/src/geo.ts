/**
 * Geo helpers for the driver app.
 *
 * Supabase/PostGIS returns `geography(Point)` columns as EWKB hex strings
 * (e.g. "0101000020E6100000..."). We decode them client-side so we can open
 * the device's maps app at the exact pickup / drop-off point — no extra DB
 * round-trip or RPC needed.
 *
 * EWKB point layout (little-endian, the only form Postgres emits here):
 *   byte 0       : byte order (0x01 = little-endian)
 *   bytes 1..4   : geometry type with SRID flag (0x20000001 = point + SRID)
 *   bytes 5..8   : SRID (4326)
 *   bytes 9..16  : X (longitude) as float64
 *   bytes 17..24 : Y (latitude)  as float64
 *
 * Verified against a known point: "...0AD7A3703D2A4140295C8FC2F5E83B40"
 * decodes to lng 34.3300, lat 27.9100.
 */

export interface LatLng {
  lat: number;
  lng: number;
}

/**
 * Decode a PostGIS EWKB hex string for a 2D point into { lat, lng }.
 * Returns null for null/empty/malformed input (callers degrade gracefully —
 * a missing pin just hides the Navigate button, never crashes).
 */
export function parseWkbPoint(wkbHex: string | null | undefined): LatLng | null {
  if (!wkbHex || typeof wkbHex !== 'string') return null;
  // A 2D point with SRID is 21 bytes = 42 hex chars; allow trailing chars defensively.
  if (wkbHex.length < 42 || !/^[0-9a-fA-F]+$/.test(wkbHex)) return null;

  try {
    const bytes = new Uint8Array(wkbHex.length / 2);
    for (let i = 0; i < bytes.length; i++) {
      bytes[i] = parseInt(wkbHex.substr(i * 2, 2), 16);
    }
    const view = new DataView(bytes.buffer);
    const littleEndian = view.getUint8(0) === 1;
    // X (lng) at offset 9, Y (lat) at offset 17.
    const lng = view.getFloat64(9, littleEndian);
    const lat = view.getFloat64(17, littleEndian);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    // Sanity: valid WGS84 ranges. Out-of-range => treat as undecodable.
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
    return { lat, lng };
  } catch {
    return null;
  }
}
