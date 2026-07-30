import { describe, expect, it } from 'vitest';
import {
  parseCashChangeNote,
  shouldRenderDropoffCard,
} from './cashChangeNote';

describe('cash-change dropoff-note v1 contract', () => {
  it('extracts the versioned customer marker and preserves the authored note', () => {
    expect(
      parseCashChangeNote(
        'Meet at reception\n[[sharmeats:cash-change:v1:tender=600;change=28]]',
        572,
      ),
    ).toEqual({
      customerNote: 'Meet at reception',
      cashChange: { tenderEgp: 600, changeEgp: 28 },
    });
  });

  it('preserves customer whitespace exactly while consuming only its separator', () => {
    const customerNote = '  Meet at reception \n';

    expect(
      parseCashChangeNote(
        `${customerNote}\n[[sharmeats:cash-change:v1:tender=600;change=28]]`,
        572,
      ),
    ).toEqual({
      customerNote,
      cashChange: { tenderEgp: 600, changeEgp: 28 },
    });
  });

  it('supports a marker-only note when no handoff preference or free text exists', () => {
    expect(
      parseCashChangeNote(
        '[[sharmeats:cash-change:v1:tender=1000;change=428]]',
        572,
      ),
    ).toEqual({
      customerNote: '',
      cashChange: { tenderEgp: 1000, changeEgp: 428 },
    });
  });

  it('rejects a marker when no collectible total is available', () => {
    const note = '[[sharmeats:cash-change:v1:tender=600;change=28]]';

    expect(parseCashChangeNote(note, null)).toEqual({
      customerNote: note,
      cashChange: null,
    });
  });

  it('leaves malformed or unsupported markers visible instead of hiding content', () => {
    for (const note of [
      'Customer text',
      '[[sharmeats:cash-change:v2:tender=600;change=28]]',
      '[[sharmeats:cash-change:v1:tender=28;change=600]]',
      '[[sharmeats:cash-change:v1:tender=unsafe;change=28]]',
    ]) {
      expect(parseCashChangeNote(note, 572)).toEqual({
        customerNote: note,
        cashChange: null,
      });
    }
  });

  it('rejects a marker whose change does not reconcile with the collectible total', () => {
    // A genuine writer always emits change = tender - total. A marker that
    // disagrees was injected into customer prose, so it must never render as
    // an authoritative cash instruction.
    expect(
      parseCashChangeNote(
        '[[sharmeats:cash-change:v1:tender=600;change=550]]',
        572,
      ),
    ).toEqual({
      customerNote: '[[sharmeats:cash-change:v1:tender=600;change=550]]',
      cashChange: null,
    });
  });

  it('accepts a reconciling marker when the total is known', () => {
    expect(
      parseCashChangeNote(
        'Meet at reception\n[[sharmeats:cash-change:v1:tender=600;change=28]]',
        572,
      ),
    ).toEqual({
      customerNote: 'Meet at reception',
      cashChange: { tenderEgp: 600, changeEgp: 28 },
    });
  });

  it('reconciles against a fractional total the same way the writer rounds it', () => {
    expect(
      parseCashChangeNote(
        '[[sharmeats:cash-change:v1:tender=600;change=28]]',
        571.5,
      ),
    ).toEqual({
      customerNote: '',
      cashChange: { tenderEgp: 600, changeEgp: 28 },
    });
  });

  it('renders a note-only card when preference is null', () => {
    const markerOnly = parseCashChangeNote(
      '[[sharmeats:cash-change:v1:tender=600;change=28]]',
      572,
    );
    const customerNoteOnly = parseCashChangeNote('Gate code 1234', 572);

    expect(shouldRenderDropoffCard(false, markerOnly)).toBe(true);
    expect(shouldRenderDropoffCard(false, customerNoteOnly)).toBe(true);
    expect(
      shouldRenderDropoffCard(false, parseCashChangeNote(null, 572)),
    ).toBe(false);
  });
});
