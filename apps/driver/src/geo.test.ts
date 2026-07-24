import { describe, expect, it } from 'vitest';
import { parseWkbPoint } from './geo';

function ewkbPoint(lng: number, lat: number): string {
  const bytes = new Uint8Array(25);
  const view = new DataView(bytes.buffer);
  view.setUint8(0, 1);
  view.setUint32(1, 0x20000001, true);
  view.setUint32(5, 4326, true);
  view.setFloat64(9, lng, true);
  view.setFloat64(17, lat, true);
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

describe('parseWkbPoint', () => {
  it('decodes the PostGIS little-endian EWKB point used by order locations', () => {
    expect(parseWkbPoint(ewkbPoint(34.33, 27.91))).toEqual({
      lng: 34.33,
      lat: 27.91,
    });
  });

  it.each([
    null,
    undefined,
    '',
    'abc',
    `${ewkbPoint(34.33, 27.91)}f`,
    `02${ewkbPoint(34.33, 27.91).slice(2)}`,
    `0102000020${ewkbPoint(34.33, 27.91).slice(10)}`,
  ])('rejects malformed or non-point input: %s', (value) => {
    expect(parseWkbPoint(value)).toBeNull();
  });

  it('rejects coordinates outside WGS84 bounds', () => {
    expect(parseWkbPoint(ewkbPoint(181, 27.91))).toBeNull();
    expect(parseWkbPoint(ewkbPoint(34.33, -91))).toBeNull();
  });
});
