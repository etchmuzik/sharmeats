/**
 * The denial contract between migration 162 and the client.
 *
 * Migration 162 deliberately collapsed VERTICAL_NOT_AVAILABLE into
 * MERCHANT_NOT_FOUND on the ordering paths so a hidden merchant is
 * indistinguishable from a missing one. That server change silently broke the
 * client detector, which only knew the old name — so the denial was classified
 * as a transport failure and the reorder fell back to CACHED menu data for a
 * merchant the server had just refused.
 *
 * These assert the contract in the shapes PostgREST actually delivers, so the
 * two layers cannot drift apart again without a red test.
 */
import { describe, it, expect, vi } from 'vitest';

// prepareCart imports the data layer, which reaches React Native. Only the pure
// classifier is under test here, so the backend is stubbed out entirely.
vi.mock('../data', () => ({ db: {}, isBackendLive: false }));

import { isVerticalDenial } from './prepareCart';

describe('isVerticalDenial', () => {
  it('recognises the mig-162 denial for a HIDDEN merchant', () => {
    // Exactly what a raised `MERCHANT_NOT_FOUND` looks like through PostgREST.
    expect(
      isVerticalDenial({
        code: 'P0001',
        message: 'MERCHANT_NOT_FOUND',
        details: null,
        hint: null,
      }),
    ).toBe(true);
  });

  it('still recognises the mig-153 name (a device may talk to either backend)', () => {
    expect(isVerticalDenial({ message: 'VERTICAL_NOT_AVAILABLE' })).toBe(true);
  });

  it('recognises a denial carried in details or hint rather than message', () => {
    expect(isVerticalDenial({ message: 'unexpected', details: 'MERCHANT_NOT_FOUND' })).toBe(true);
    expect(isVerticalDenial({ message: 'unexpected', hint: 'VERTICAL_NOT_AVAILABLE' })).toBe(true);
  });

  it('recognises a wrapped/stringified denial', () => {
    expect(isVerticalDenial('error: MERCHANT_NOT_FOUND')).toBe(true);
    expect(isVerticalDenial(new Error('MERCHANT_NOT_FOUND'))).toBe(true);
  });

  it('does NOT treat a genuine transport failure as a denial', () => {
    // These must still fall back to the offline path — that is the whole point
    // of distinguishing refusal from outage.
    expect(isVerticalDenial(new Error('Network request failed'))).toBe(false);
    expect(isVerticalDenial({ code: 'PGRST202', message: 'function does not exist' })).toBe(false);
    expect(isVerticalDenial({ message: 'timeout of 10000ms exceeded' })).toBe(false);
  });

  it('handles null and malformed errors without throwing', () => {
    expect(isVerticalDenial(null)).toBe(false);
    expect(isVerticalDenial(undefined)).toBe(false);
    expect(isVerticalDenial({})).toBe(false);
    expect(isVerticalDenial({ message: 42 })).toBe(false);
  });
});
