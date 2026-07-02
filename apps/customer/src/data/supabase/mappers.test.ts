import { describe, it, expect } from 'vitest';
import { rowToOrder, rowToRewardsHistoryEntry, rowToRewardsStatus, rowToRider } from './mappers';

// These tests pin down the exact crash/render bugs fixed this session so they
// can't regress. rowToOrder exercises the module-private tsToMs +
// normalizeAddressSnapshot helpers, plus the items/history array coercion.

// Minimal valid order row; individual tests override the field under test.
const baseRow = {
  id: 'order-1',
  short_code: 'SE-TEST',
  status: 'placed',
  restaurant_id: 'r1',
  restaurant_name: 'Test Kitchen',
  items: [],
  history: [],
  total_egp: 100,
  subtotal_egp: 90,
  delivery_fee_egp: 10,
  tip_egp: 0,
  discount_egp: 0,
  payment_method: 'cash_on_delivery',
  payment_status: 'pending',
  placed_at: '2026-06-27 23:36:59+00',
  address_snapshot: null,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
} as any;

describe('tsToMs (via rowToOrder) — the "NaN min" Hermes bug', () => {
  it('parses Realtime space-separated timestamptz to a real epoch (not NaN)', () => {
    const o = rowToOrder({ ...baseRow, placed_at: '2026-06-27 23:36:59+00' });
    expect(Number.isNaN(o.placedAt)).toBe(false);
    expect(o.placedAt).toBe(new Date('2026-06-27T23:36:59+00:00').getTime());
  });

  it('parses an already-ISO timestamp too', () => {
    const o = rowToOrder({ ...baseRow, placed_at: '2026-06-27T23:36:59Z' });
    expect(Number.isNaN(o.placedAt)).toBe(false);
  });

  it('falls back to a number (not NaN) when placed_at is null', () => {
    const o = rowToOrder({ ...baseRow, placed_at: null });
    expect(typeof o.placedAt).toBe('number');
    expect(Number.isNaN(o.placedAt)).toBe(false);
  });

  it('leaves eta undefined-safe — etaAt is always a number', () => {
    const o = rowToOrder({ ...baseRow, eta_at: undefined });
    expect(typeof o.etaAt).toBe('number');
  });
});

describe('normalizeAddressSnapshot (via rowToOrder) — blank hotel card bug', () => {
  it('maps snake_case address_snapshot to camelCase hotel fields', () => {
    const o = rowToOrder({
      ...baseRow,
      address_snapshot: {
        id: 'a1',
        kind: 'hotel',
        hotel_name: 'Rixos Premium',
        room_number: '412',
        is_default: true,
      },
    });
    expect(o.addressSnapshot?.hotelName).toBe('Rixos Premium');
    expect(o.addressSnapshot?.roomNumber).toBe('412');
    expect(o.addressSnapshot?.kind).toBe('hotel');
  });

  it('is idempotent — already-camelCase input passes through', () => {
    const o = rowToOrder({
      ...baseRow,
      address_snapshot: { id: 'a1', kind: 'hotel', hotelName: 'Already Camel', roomNumber: '7' },
    });
    expect(o.addressSnapshot?.hotelName).toBe('Already Camel');
    expect(o.addressSnapshot?.roomNumber).toBe('7');
  });

  it('does not throw on a null address_snapshot', () => {
    expect(() => rowToOrder({ ...baseRow, address_snapshot: null })).not.toThrow();
  });
});

describe('items/history array coercion — render-throw bugs', () => {
  it('coerces a non-array history to [] so .find/.map never throws', () => {
    const o = rowToOrder({ ...baseRow, history: null });
    expect(Array.isArray(o.history)).toBe(true);
    expect(o.history).toEqual([]);
  });

  it('coerces a non-array items to [] (no .map crash)', () => {
    const o = rowToOrder({ ...baseRow, items: undefined });
    expect(Array.isArray(o.items)).toBe(true);
  });

  it('synthesizes a stable lineId for items missing one (no dup React keys)', () => {
    const o = rowToOrder({
      ...baseRow,
      items: [
        { itemId: 'i1', name: 'A', basePriceEgp: 10, quantity: 1 },
        { itemId: 'i2', name: 'B', basePriceEgp: 20, quantity: 2 },
      ],
    });
    const ids = o.items.map((it) => it.lineId);
    expect(ids[0]).toBeTruthy();
    expect(ids[1]).toBeTruthy();
    expect(ids[0]).not.toBe(ids[1]); // unique → no duplicate keys
  });
});

describe('rowToRider — rating guard', () => {
  it('maps a rider with a numeric rating', () => {
    const r = rowToRider({
      id: 'd1',
      name: 'Ahmed',
      photo: '',
      vehicle: 'Scooter',
      plate: 'ABC-123',
      rating: 4.8,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
    expect(r.rating).toBe(4.8);
  });
});

describe('rowToRewardsStatus', () => {
  it('maps a customer_loyalty row', () => {
    const result = rowToRewardsStatus({ tier: 'gold', points_balance: 500, points_rolling_12mo: 2100 });
    expect(result).toEqual({ tier: 'gold', pointsBalance: 500, pointsRolling12mo: 2100 });
  });
});

describe('rowToRewardsHistoryEntry', () => {
  it('maps a ledger row and parses the timestamp', () => {
    const result = rowToRewardsHistoryEntry({
      id: 'abc',
      delta_points: -50,
      reason: 'redeem',
      ref_order_id: null,
      created_at: '2026-07-01T12:00:00+00:00',
    });
    expect(result.deltaPoints).toBe(-50);
    expect(result.reason).toBe('redeem');
    expect(result.refOrderId).toBeNull();
    expect(typeof result.createdAt).toBe('number');
  });
});
