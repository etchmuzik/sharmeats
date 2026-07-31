import { describe, expect, it } from 'vitest';
import { isOfferLive, normalizeAddressSnapshot, normalizeJob, type Assignment } from './jobs';

function offer(overrides: Partial<Assignment> = {}): Assignment {
  return {
    id: 'assignment-1',
    order_id: 'order-1',
    status: 'offered',
    offer_expires_at: new Date().toISOString(),
    restaurant_name: 'Test Kitchen',
    dropoff_zone: 'naama_bay',
    delivery_fee_egp: 30,
    tip_egp: 0,
    order_status: 'ready',
    ...overrides,
  };
}

describe('isOfferLive — an offer must die with its order', () => {
  it('keeps offers on orders that can still be picked up', () => {
    for (const status of ['placed', 'accepted', 'preparing', 'ready'] as const) {
      expect(isOfferLive(offer({ order_status: status })), status).toBe(true);
    }
  });

  // Two of the three stuck `offered` rows in production were on CANCELLED
  // orders. Accepting one silently removed the driver from the dispatch pool
  // for a delivery that could never happen.
  it('drops offers on terminal orders', () => {
    for (const status of ['delivered', 'cancelled', 'rejected'] as const) {
      expect(isOfferLive(offer({ order_status: status })), status).toBe(false);
    }
  });

  // Fails CLOSED: if the order row is not readable we cannot claim the job is
  // still available, and hiding a live offer costs nothing (the sweep re-offers).
  it('drops an offer whose order status is unknown', () => {
    expect(isOfferLive(offer({ order_status: null }))).toBe(false);
  });
});

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
    // A legacy order (pre-mig-160) carries no requiresPrescription key, so the
    // normalizer must default it to FALSE — never undefined, which would read
    // as "unknown" at a handover, and never true.
    expect(job?.items).toEqual([
      { name: 'Koshari', quantity: 2, notes: null, requiresPrescription: false },
    ]);
  });

  it('returns null for an absent order row', () => {
    expect(normalizeJob(null)).toBeNull();
  });
});
