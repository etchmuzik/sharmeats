import { describe, expect, it } from 'vitest';
import {
  hasVerifiedFactor,
  isCompleteTotpCode,
  mfaGate,
  mfaRouteRedirect,
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
  it('allows an optional-MFA account with no factor (aal1/aal1)', () => {
    expect(mfaGate('aal1', 'aal1')).toBe('not_enrolled');
  });

  it('requires an admin with no factor to enroll before using ops authority', () => {
    expect(mfaGate('aal1', 'aal1', { enrollmentRequired: true })).toBe(
      'enrollment_required',
    );
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

  it('treats aal2/aal1 as a stale token after factor removal', () => {
    expect(mfaGate('aal2', 'aal1')).toBe('not_enrolled');
    expect(mfaGate('aal2', 'aal1', { enrollmentRequired: true })).toBe(
      'enrollment_required',
    );
  });

  it('fails closed when the assurance level cannot be determined', () => {
    expect(mfaGate(null, null)).toBe('indeterminate');
    expect(mfaGate(undefined, undefined)).toBe('indeterminate');
    expect(mfaGate('', '')).toBe('indeterminate');
  });
});

describe('mfaRouteRedirect — the shell cannot expose an aal1 admin session', () => {
  it('sends an unenrolled admin only to the enrollment page', () => {
    expect(mfaRouteRedirect('/', 'admin', 'enrollment_required')).toBe('/security');
    expect(mfaRouteRedirect('/finance', 'admin', 'enrollment_required')).toBe('/security');
    expect(mfaRouteRedirect('/security', 'admin', 'enrollment_required')).toBeNull();
  });

  it('sends a session that owes a code back through login', () => {
    expect(mfaRouteRedirect('/finance', 'admin', 'code_required')).toBe('/login');
    expect(mfaRouteRedirect('/', 'dispatcher', 'code_required')).toBe('/login');
  });

  it('fails closed on an indeterminate assurance result', () => {
    expect(mfaRouteRedirect('/', 'admin', 'indeterminate')).toBe('/login');
  });

  it('preserves dispatcher access when MFA was never enrolled', () => {
    expect(mfaRouteRedirect('/', 'dispatcher', 'not_enrolled')).toBeNull();
  });

  it('allows an aal2 admin session to use every dashboard route', () => {
    expect(mfaRouteRedirect('/finance', 'admin', 'satisfied')).toBeNull();
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
