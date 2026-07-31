/**
 * The rule this enforces: a backend string never reaches the customer.
 *
 * Sign-in and OTP rendered `e.message` verbatim, so a tourist in a hotel lobby
 * could be told to "enable a Phone provider in Supabase → Authentication →
 * Providers → Phone". Every branch here must return an i18n KEY, and the honest
 * answer for an unrecognised failure is the caller's own generic key — not the
 * backend's wording.
 */
import { describe, it, expect } from 'vitest';
import { authErrorKey } from './authErrors';

const FALLBACK = 'error.otpSendFailed';

describe('authErrorKey', () => {
  it('never returns the backend message, however specific it looks', () => {
    const leak = new Error(
      'Could not send the code — enable a Phone provider in Supabase → Authentication → Providers → Phone. (sms provider disabled)',
    );
    expect(authErrorKey(leak, FALLBACK)).toBe(FALLBACK);
    expect(authErrorKey(leak, FALLBACK)).not.toContain('Supabase');
  });

  it('calls out rate limiting, where "try again" would be wrong advice', () => {
    expect(authErrorKey(Object.assign(new Error('nope'), { status: 429 }), FALLBACK)).toBe(
      'error.otpTooMany',
    );
    expect(
      authErrorKey(new Error('For security purposes, you can only request this after 51s'), FALLBACK),
    ).toBe('error.otpTooMany');
  });

  it('recognises a transport failure so the customer checks their connection', () => {
    expect(authErrorKey(new TypeError('Network request failed'), FALLBACK)).toBe('error.network');
    expect(authErrorKey(new Error('fetch timed out'), FALLBACK)).toBe('error.network');
  });

  it('recognises a bad or expired one-time code', () => {
    expect(authErrorKey(new Error('Token has expired or is invalid'), FALLBACK)).toBe(
      'error.otpInvalid',
    );
  });

  it('falls back for non-Error throws rather than stringifying them at the user', () => {
    expect(authErrorKey('boom', FALLBACK)).toBe(FALLBACK);
    expect(authErrorKey(null, FALLBACK)).toBe(FALLBACK);
    expect(authErrorKey(undefined, FALLBACK)).toBe(FALLBACK);
  });

  it('honours the caller’s own fallback key', () => {
    expect(authErrorKey(new Error('???'), 'error.otpResendFailed')).toBe('error.otpResendFailed');
  });
});
