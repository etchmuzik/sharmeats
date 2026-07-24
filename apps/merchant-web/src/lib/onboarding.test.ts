import { describe, expect, it } from 'vitest';
import { resolveOnboardingPhase, rpcErrorToCopy } from './onboarding';

const staff = (onboarding_status: string) => ({
  restaurant_id: 'r1',
  restaurants: { onboarding_status, onboarding_rejection_reason: null, name: 'T' },
});

describe('resolveOnboardingPhase', () => {
  it('is none with no staff link', () => {
    expect(resolveOnboardingPhase(null)).toBe('none');
    expect(resolveOnboardingPhase(undefined)).toBe('none');
  });
  it('maps submitted', () => {
    expect(resolveOnboardingPhase(staff('submitted'))).toBe('submitted');
  });
  it('maps rejected', () => {
    expect(resolveOnboardingPhase(staff('rejected'))).toBe('rejected');
  });
  it('approved and live (and legacy/unknown) are active', () => {
    expect(resolveOnboardingPhase(staff('approved'))).toBe('active');
    expect(resolveOnboardingPhase(staff('live'))).toBe('active');
    expect(resolveOnboardingPhase(staff('draft'))).toBe('active'); // never client-visible; fail open to dashboard
  });
});

describe('rpcErrorToCopy', () => {
  it('maps every typed code to human copy', () => {
    expect(rpcErrorToCopy('ZONE_NOT_SERVED')).toMatch(/don.t deliver/i);
    expect(rpcErrorToCopy('GEO_OUT_OF_AREA')).toMatch(/Sharm/i);
    expect(rpcErrorToCopy('NOT_ELIGIBLE')).toMatch(/account/i);
    expect(rpcErrorToCopy('INVALID_NAME')).toMatch(/name/i);
    expect(rpcErrorToCopy('INVALID_PHONE')).toMatch(/phone/i);
    expect(rpcErrorToCopy('TERMS_REQUIRED')).toMatch(/terms/i);
  });
  it('embedded codes still match (Postgres prefixes messages)', () => {
    expect(rpcErrorToCopy('P0001: ZONE_NOT_SERVED')).toMatch(/don.t deliver/i);
  });
  it('unknown errors get the generic fallback', () => {
    expect(rpcErrorToCopy('something odd')).toMatch(/try again/i);
  });
});
