import { describe, expect, it } from 'vitest';
import {
  describeFxError,
  expiryLabel,
  fxHealth,
  isMissingFunction,
  jumpPct,
  validateFxForm,
  type FxRateRow,
} from './fx';

const NOW = new Date('2026-08-01T12:00:00Z');

function row(overrides: Partial<FxRateRow> = {}): FxRateRow {
  return {
    quote_currency: 'EUR',
    rate: 52.85,
    source: 'manual',
    effective_at: '2026-07-30T12:00:00Z',
    stale_after: '2026-08-06T12:00:00Z',
    stale: false,
    ...overrides,
  };
}

describe('fxHealth', () => {
  it('reports a currency with no active row as missing', () => {
    // The state the database cannot describe: current_fx_rates() simply has no
    // row, and the currency silently vanishes from the customer's conversion.
    expect(fxHealth(undefined, NOW)).toBe('missing');
  });

  it('trusts the server stale flag over the browser clock', () => {
    // A skewed local clock must never be able to call a stale rate live.
    expect(fxHealth(row({ stale: true, stale_after: '2027-01-01T00:00:00Z' }), NOW)).toBe('stale');
  });

  it('warns before expiry, not after', () => {
    expect(fxHealth(row({ stale_after: '2026-08-03T00:00:00Z' }), NOW)).toBe('expiring');
    expect(fxHealth(row({ stale_after: '2026-08-06T12:00:00Z' }), NOW)).toBe('live');
    expect(fxHealth(row({ stale_after: '2026-07-31T12:00:00Z' }), NOW)).toBe('stale');
  });
});

describe('expiryLabel', () => {
  it('reads in days beyond two days and hours below', () => {
    expect(expiryLabel('2026-08-06T12:00:00Z', NOW)).toBe('in 5d');
    expect(expiryLabel('2026-08-02T00:00:00Z', NOW)).toBe('in 12h');
    expect(expiryLabel('2026-07-29T12:00:00Z', NOW)).toBe('3d ago');
  });
});

describe('jumpPct', () => {
  it('measures the move against the live rate', () => {
    expect(jumpPct(50, 55)).toBeCloseTo(10);
    expect(jumpPct(50, 45)).toBeCloseTo(10);
  });

  it('has no opinion with no previous rate', () => {
    expect(jumpPct(undefined, 52)).toBeNull();
    expect(jumpPct(0, 52)).toBeNull();
  });
});

describe('validateFxForm — mirrors the RPC bounds', () => {
  const valid = { quote: 'EUR', rate: '54.2', reason: 'CBE mid-market 2026-08-01', staleHours: '168' };

  it('accepts a well-formed override and normalises the currency', () => {
    const result = validateFxForm({ ...valid, quote: 'eur' });
    expect(result).toEqual({
      ok: true,
      values: { quote: 'EUR', rate: 54.2, reason: 'CBE mid-market 2026-08-01', staleHours: 168 },
    });
  });

  it('rejects an unsupported currency', () => {
    expect(validateFxForm({ ...valid, quote: 'AED' }).ok).toBe(false);
  });

  it('catches an inverted rate before it costs a round trip', () => {
    // 0.019 EGP per EUR is the classic swapped-orientation bug.
    const result = validateFxForm({ ...valid, rate: '0.019' });
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error).toContain('EGP per 1 EUR');
  });

  it('catches a fat-fingered order of magnitude', () => {
    expect(validateFxForm({ ...valid, rate: '5285' }).ok).toBe(false);
  });

  it('requires a real reason — the row is the audit trail', () => {
    expect(validateFxForm({ ...valid, reason: '  x ' }).ok).toBe(false);
  });

  it('bounds the shelf life to whole hours in 1..720', () => {
    expect(validateFxForm({ ...valid, staleHours: '0' }).ok).toBe(false);
    expect(validateFxForm({ ...valid, staleHours: '721' }).ok).toBe(false);
    expect(validateFxForm({ ...valid, staleHours: '12.5' }).ok).toBe(false);
    expect(validateFxForm({ ...valid, staleHours: '720' }).ok).toBe(true);
  });

  it('rejects a blank or non-numeric rate rather than reading it as 0', () => {
    expect(validateFxForm({ ...valid, rate: '' }).ok).toBe(false);
    expect(validateFxForm({ ...valid, rate: 'fifty' }).ok).toBe(false);
  });
});

describe('describeFxError', () => {
  it('turns a jump rejection into an instruction', () => {
    const text = describeFxError('RATE_JUMP_REJECTED: 52.85 -> 70.0 is 32.4% — re-run with allow_jump if intended');
    expect(text).toContain('intended');
  });

  it('passes an unrecognised message through rather than swallowing it', () => {
    expect(describeFxError('connection terminated')).toBe('connection terminated');
  });
});

describe('isMissingFunction', () => {
  it('recognises a database that has not had migration 182 applied', () => {
    expect(isMissingFunction({ code: 'PGRST202', message: 'x' })).toBe(true);
    expect(isMissingFunction({ message: 'Could not find the function public.admin_set_fx_rate' })).toBe(true);
  });

  it('does not mistake a real failure for a missing migration', () => {
    expect(isMissingFunction({ code: '42501', message: 'permission denied' })).toBe(false);
    expect(isMissingFunction(null)).toBe(false);
  });
});
