import { describe, expect, it } from 'vitest';
import {
  hasVerifiedFactor,
  isCompleteTotpCode,
  mfaGate,
  normalizeTotpCode,
  staleUnverifiedFactorIds,
  toFactorViews,
} from './mfa';

/**
 * These assertions first ran via tsx on 2026-07-30, the night MFA shipped,
 * because admin-web had no test runner. They are now the permanent record of
 * the security contract — in particular the gate truth table, which is easy to
 * regress because Supabase's currentLevel/nextLevel pair reads ambiguously.
 */
describe('mfaGate — the truth table is the security contract', () => {
  it('does not prompt an account with no factor (aal1/aal1)', () => {
    expect(mfaGate('aal1', 'aal1')).toBe('not_enrolled');
  });

  it('demands a code when a verified factor exists and is unsatisfied (aal1/aal2)', () => {
    // THE load-bearing case: signInWithPassword leaves the session at aal1 and
    // Supabase does not block on its own. If this returned anything but
    // 'code_required', enrolling MFA would protect nothing.
    expect(mfaGate('aal1', 'aal2')).toBe('code_required');
  });

  it('lets a verified session straight through (aal2/aal2)', () => {
    expect(mfaGate('aal2', 'aal2')).toBe('satisfied');
  });

  it('treats current aal2 as satisfied regardless of nextLevel', () => {
    expect(mfaGate('aal2', 'aal1')).toBe('satisfied');
  });

  it('fails OPEN on an indeterminate answer — a transient must not lock out the only admin', () => {
    expect(mfaGate(null, null)).toBe('not_enrolled');
    expect(mfaGate(undefined, undefined)).toBe('not_enrolled');
    expect(mfaGate('', '')).toBe('not_enrolled');
  });
});

describe('normalizeTotpCode', () => {
  it('strips the space authenticator apps display ("123 456")', () => {
    expect(normalizeTotpCode('123 456')).toBe('123456');
  });

  it('strips non-digits from paste artifacts', () => {
    expect(normalizeTotpCode('12a3b45c6')).toBe('123456');
  });

  it('truncates over-length input to six digits', () => {
    expect(normalizeTotpCode('1234567890')).toBe('123456');
  });

  it('tolerates null-ish input', () => {
    expect(normalizeTotpCode('')).toBe('');
  });
});

describe('isCompleteTotpCode', () => {
  it('rejects five digits', () => {
    expect(isCompleteTotpCode('12345')).toBe(false);
  });

  it('accepts six digits even with the display space', () => {
    expect(isCompleteTotpCode('123 456')).toBe(true);
  });
});

describe('factor views', () => {
  const views = toFactorViews([
    { id: 'a', friendly_name: 'Phone', status: 'verified' },
    { id: 'b', friendly_name: '  ', status: 'unverified' },
  ]);

  it('falls back to a readable name when friendly_name is blank', () => {
    expect(views[1].friendlyName).toBe('Authenticator app');
  });

  it('identifies stale unverified factors — the ones that block a re-enrol', () => {
    expect(staleUnverifiedFactorIds(views)).toEqual(['b']);
  });

  it('reports protected only when a factor is actually verified', () => {
    expect(hasVerifiedFactor(views)).toBe(true);
    expect(hasVerifiedFactor([{ id: 'x', friendlyName: 'y', verified: false }])).toBe(false);
  });

  it('tolerates a null factor list', () => {
    expect(toFactorViews(null)).toEqual([]);
    expect(toFactorViews(undefined)).toEqual([]);
  });
});
