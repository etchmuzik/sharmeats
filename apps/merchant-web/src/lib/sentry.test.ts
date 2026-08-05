import { describe, expect, it, vi } from 'vitest';

vi.mock('@sentry/nextjs', () => ({
  init: vi.fn(),
  captureException: vi.fn(),
}));

import { normaliseError } from './sentry';

describe('merchant Sentry redaction', () => {
  it('keeps only a safe PostgREST code, never a PII-bearing backend payload', () => {
    const { error, extra } = normaliseError({
      code: '23505',
      details: 'Key (phone)=(+201234567890) already exists.',
      hint: 'Remove the duplicate address.',
      message: 'duplicate key value violates unique constraint',
    });

    expect(error.message).toBe('Operation failed');
    expect(error.name).toBe('PostgrestError 23505');
    expect(extra).toEqual({ code: '23505' });
    expect(JSON.stringify({ error, extra })).not.toContain('+201234567890');
  });

  it('redacts a real Error because SDK messages can echo customer input', () => {
    const { error } = normaliseError(new TypeError('delivery for room 812; token=secret'));

    expect(error.name).toBe('TypeError');
    expect(error.message).toBe('Operation failed');
    expect(JSON.stringify({ error })).not.toContain('room 812');
    expect(JSON.stringify({ error })).not.toContain('secret');
  });
});
