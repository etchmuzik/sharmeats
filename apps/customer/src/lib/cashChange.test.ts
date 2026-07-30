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

  it('rejects a tender the driver could not plausibly make change for', () => {
    // A doorstep handoff fails if the driver is asked to carry change no
    // courier float covers. Caught at checkout, not at the door.
    for (const value of ['60000', '999999999999']) {
      expect(cashTenderForTotal(value, 572)).toEqual({ kind: 'invalid' });
    }
  });

  it('still accepts a realistic large-note tender', () => {
    // Egypt's largest circulating note is 200 EGP; paying a 572 EGP order with
    // 1000 (5 x 200) must remain valid.
    expect(cashTenderForTotal('1000', 572)).toEqual({
      kind: 'valid',
      tenderEgp: 1000,
      changeEgp: 428,
    });
  });

  it('scales the ceiling with the order total', () => {
    // A large order legitimately needs a large tender: 4000 on a 3800 order is
    // fine even though it exceeds the ceiling of a small order.
    expect(cashTenderForTotal('4000', 3800)).toEqual({
      kind: 'valid',
      tenderEgp: 4000,
      changeEgp: 200,
    });
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
    ).toBe(
      'Meet at reception\n[[sharmeats:cash-change:v1:tender=600;change=28]]',
    );
  });

  it('preserves customer-authored whitespace byte-for-byte before the marker', () => {
    const customerNote = '  Meet at reception \n';

    expect(
      composeDriverDropoffNote(customerNote, {
        kind: 'valid',
        tenderEgp: 600,
        changeEgp: 28,
      }),
    ).toBe(
      `${customerNote}\n[[sharmeats:cash-change:v1:tender=600;change=28]]`,
    );
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

  it('neutralizes a marker the customer typed into their own note', () => {
    const spoofed =
      'Leave at door [[sharmeats:cash-change:v1:tender=600;change=550]]';

    const composed = composeDriverDropoffNote(spoofed, { kind: 'none' });

    expect(composed).not.toMatch(/\[\[sharmeats:cash-change:/);
    expect(composed).toContain('Leave at door');
  });

  it('keeps the generated marker authoritative when prose also contains one', () => {
    const spoofed = '[[sharmeats:cash-change:v1:tender=600;change=550]]';

    expect(
      composeDriverDropoffNote(spoofed, {
        kind: 'valid',
        tenderEgp: 600,
        changeEgp: 28,
      }),
    ).toBe(
      '[[sharmeats:cash-change:v1:tender=600;change=28]]',
    );
  });
});
