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
      ),
    ).toEqual({
      customerNote,
      cashChange: { tenderEgp: 600, changeEgp: 28 },
    });
  });

  it('supports a marker-only note when no handoff preference or free text exists', () => {
    expect(
      parseCashChangeNote('[[sharmeats:cash-change:v1:tender=1000;change=428]]'),
    ).toEqual({
      customerNote: '',
      cashChange: { tenderEgp: 1000, changeEgp: 428 },
    });
  });

  it('leaves malformed or unsupported markers visible instead of hiding content', () => {
    for (const note of [
      'Customer text',
      '[[sharmeats:cash-change:v2:tender=600;change=28]]',
      '[[sharmeats:cash-change:v1:tender=28;change=600]]',
      '[[sharmeats:cash-change:v1:tender=unsafe;change=28]]',
    ]) {
      expect(parseCashChangeNote(note)).toEqual({
        customerNote: note,
        cashChange: null,
      });
    }
  });

  it('renders a note-only card when preference is null', () => {
    const markerOnly = parseCashChangeNote(
      '[[sharmeats:cash-change:v1:tender=600;change=28]]',
    );
    const customerNoteOnly = parseCashChangeNote('Gate code 1234');

    expect(shouldRenderDropoffCard(false, markerOnly)).toBe(true);
    expect(shouldRenderDropoffCard(false, customerNoteOnly)).toBe(true);
    expect(
      shouldRenderDropoffCard(false, parseCashChangeNote(null)),
    ).toBe(false);
  });
});
