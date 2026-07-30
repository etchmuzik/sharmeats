/**
 * Acquisition deep-link parsing (Package 05 Slice D) — the hostile-input edge.
 * Server-side degradation is proven in the mig-183 dry run; this guards the
 * client's token validation so a malicious link cannot push free text inward.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: { getItem: vi.fn(), setItem: vi.fn() },
}));
vi.mock('expo-linking', () => ({
  parse: (url: string) => {
    const u = new URL(url.replace('sharmeats://', 'https://x/'));
    const queryParams: Record<string, string> = {};
    u.searchParams.forEach((v, k) => (queryParams[k] = v));
    return { queryParams, path: u.pathname.replace(/^\//, '') };
  },
  getInitialURL: vi.fn(),
  addEventListener: vi.fn(),
}));
vi.mock('../data', () => ({ db: {}, isBackendLive: false }));
vi.mock('./analytics', () => ({ setAnalyticsContext: vi.fn() }));

import { parseAcquisitionParams } from './acquisition';

describe('parseAcquisitionParams', () => {
  it('extracts a full partner QR payload', () => {
    const p = parseAcquisitionParams('sharmeats://open?src=hotel_qr&campaign=hilton-lobby&partner=HILTON1');
    expect(p).toEqual({ source: 'hotel_qr', campaign: 'hilton-lobby', partner: 'HILTON1', path: '/open' });
  });

  it('returns null when no src param — an ordinary deep link is not a touch', () => {
    expect(parseAcquisitionParams('sharmeats://restaurant/abc')).toBeNull();
  });

  it('rejects free-text and injection-shaped params', () => {
    expect(parseAcquisitionParams('sharmeats://open?src=hello world')).toBeNull();
    expect(parseAcquisitionParams("sharmeats://open?src='; drop table--")).toBeNull();
    const p = parseAcquisitionParams('sharmeats://open?src=hotel_qr&campaign=a b c&partner=<x>');
    expect(p?.campaign).toBeNull();
    expect(p?.partner).toBeNull();
    expect(p?.source).toBe('hotel_qr');
  });

  it('never throws on garbage URLs', () => {
    expect(parseAcquisitionParams('not a url at all')).toBeNull();
  });
});
