import { describe, expect, it } from 'vitest';
import { cashTenderForTotal, composeDriverDropoffNote } from './cashChange';

describe('cashTenderForTotal', () => {
  it('treats an empty optional field as no cash-change request', () => {
    expect(cashTenderForTotal('', 572)).toEqual({ kind: 'none' });
    expect(cashTenderForTotal('   ', 572)).toEqual({ kind: 'none' });
  });

  it('calculates the change a driver should bring', () => {
    expect(cashTenderForTotal('600', 572)).toEqual({
      kind: 'valid',
      tenderEgp: 600,
      changeEgp: 28,
    });
  });

  it('accepts Arabic-Indic digits and common thousands separators', () => {
    expect(cashTenderForTotal('١٬٠٠٠', 572)).toEqual({
      kind: 'valid',
      tenderEgp: 1000,
      changeEgp: 428,
    });
  });

  it('rejects a tender amount below the order total', () => {
    expect(cashTenderForTotal('500', 572)).toEqual({ kind: 'invalid' });
  });

  it('rejects malformed and non-finite values', () => {
    for (const value of ['six hundred', '60.0.0', '-600', '0']) {
      expect(cashTenderForTotal(value, 572)).toEqual({ kind: 'invalid' });
    }
  });
});

describe('composeDriverDropoffNote', () => {
  it('preserves the customer note when no change is requested', () => {
    expect(composeDriverDropoffNote('Meet at reception', { kind: 'none' })).toBe(
      'Meet at reception',
    );
  });

  it('adds an operational cash instruction with the exact change', () => {
    expect(
      composeDriverDropoffNote('Meet at reception', {
        kind: 'valid',
        tenderEgp: 600,
        changeEgp: 28,
      }),
    ).toBe('Meet at reception · Cash: customer will pay 600 EGP; bring 28 EGP change.');
  });

  it('does not add a redundant instruction for exact cash', () => {
    expect(
      composeDriverDropoffNote('', {
        kind: 'valid',
        tenderEgp: 572,
        changeEgp: 0,
      }),
    ).toBe('');
  });
});
