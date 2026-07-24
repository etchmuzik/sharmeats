import { describe, expect, it } from 'vitest';
import { normalizeAddressSnapshot, normalizeJob } from './jobs';

describe('driver job normalization', () => {
  it('maps snake_case address snapshots without dropping hotel handoff details', () => {
    expect(
      normalizeAddressSnapshot({
        kind: 'hotel',
        hotel_name: 'Coral Hotel',
        room_number: '418',
        street_text: 'Peace Road',
        beach_name: 'Sharks Bay',
      }),
    ).toMatchObject({
      kind: 'hotel',
      hotelName: 'Coral Hotel',
      roomNumber: '418',
      streetText: 'Peace Road',
      beachName: 'Sharks Bay',
    });
  });

  it('normalizes joined restaurant geo and legacy item quantity', () => {
    const job = normalizeJob({
      id: 'order-1',
      short_code: 'SE-1001',
      restaurant_name: 'Test Kitchen',
      status: 'ready',
      payment_method: 'cash_on_delivery',
      payment_status: 'pending',
      total_egp: 200,
      subtotal_egp: 160,
      delivery_fee_egp: 30,
      tip_egp: 10,
      items: [{ name: 'Koshari', qty: 2 }],
      address_snapshot: {},
      restaurants: [{ geo: 'point-wkb' }],
    });

    expect(job).not.toBeNull();
    expect(job?.restaurant_geo).toBe('point-wkb');
    expect(job?.items).toEqual([{ name: 'Koshari', quantity: 2, notes: null }]);
  });

  it('returns null for an absent order row', () => {
    expect(normalizeJob(null)).toBeNull();
  });
});
