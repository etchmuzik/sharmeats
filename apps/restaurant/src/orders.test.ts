import { describe, expect, it } from 'vitest';
import {
  ACTIVE_ORDER_WINDOW_HOURS,
  activeOrderSince,
  allergenLabel,
  isActive,
  isVisible,
  isWithinQueueWindow,
  normalizeRestaurantOrder,
} from './orders';

function rawOrder(addressSnapshot: unknown) {
  return {
    id: 'order-1',
    short_code: 'SE-1001',
    restaurant_id: 'restaurant-1',
    status: 'placed',
    payment_method: 'cash_on_delivery',
    payment_status: 'pending',
    fulfillment_type: 'platform',
    total_egp: 420,
    address_snapshot: addressSnapshot,
    items: [],
    kitchen_notes: null,
    scheduled_for: null,
    placed_at: '2026-07-24T10:00:00.000Z',
    aggregate_allergens: null,
    customer_phone: null,
  };
}

describe('restaurant order normalization', () => {
  it('maps the database snake_case address snapshot used by place_order', () => {
    const order = normalizeRestaurantOrder(
      rawOrder({
        kind: 'hotel',
        label: 'Naama Bay',
        hotel_name: 'Coral Hotel',
        room_number: '418',
        street_text: null,
        beach_name: null,
      }),
    );

    expect(order.address_snapshot).toMatchObject({
      kind: 'hotel',
      label: 'Naama Bay',
      hotelName: 'Coral Hotel',
      roomNumber: '418',
    });
  });

  it('keeps already-normalized camelCase values from realtime payloads', () => {
    const order = normalizeRestaurantOrder(
      rawOrder({
        kind: 'street',
        streetText: 'Peace Road',
        building: '12',
        apartment: '4',
      }),
    );

    expect(order.address_snapshot).toMatchObject({
      kind: 'street',
      streetText: 'Peace Road',
      building: '12',
      apartment: '4',
    });
  });

  it('handles a missing snapshot without inventing address data', () => {
    expect(normalizeRestaurantOrder(rawOrder(null)).address_snapshot).toBeNull();
  });
});

describe('restaurant order policy helpers', () => {
  it.each(['delivered', 'cancelled', 'rejected'] as const)(
    'treats %s as terminal',
    (status) => expect(isActive(status)).toBe(false),
  );

  it('shows COD immediately but hides unpaid card orders', () => {
    expect(
      isVisible({ payment_method: 'cash_on_delivery', payment_status: 'pending' }),
    ).toBe(true);
    expect(isVisible({ payment_method: 'card', payment_status: 'pending' })).toBe(false);
    expect(isVisible({ payment_method: 'card', payment_status: 'paid' })).toBe(true);
  });

  it('provides kitchen-safe allergen labels', () => {
    expect(allergenLabel('shellfish')).toBe('Shellfish');
    expect(allergenLabel('sesame')).toBe('Sesame');
  });
});

describe('kitchen queue age bound', () => {
  const NOW = Date.parse('2026-07-31T20:00:00.000Z');
  const HOUR = 3_600_000;

  it('reaches back exactly one service window', () => {
    expect(Date.parse(activeOrderSince(NOW))).toBe(NOW - ACTIVE_ORDER_WINDOW_HOURS * HOUR);
  });

  it('keeps tonight and drops the 238-hour ghost', () => {
    expect(isWithinQueueWindow(new Date(NOW - 2 * HOUR).toISOString(), NOW)).toBe(true);
    expect(isWithinQueueWindow(new Date(NOW - 238 * HOUR).toISOString(), NOW)).toBe(false);
  });

  it('never HIDES a ticket because its timestamp is unreadable', () => {
    // Same fail-open-toward-visible rule the ticket's wait timer uses: dropping
    // a live order is far worse than showing one extra.
    expect(isWithinQueueWindow('not-a-date', NOW)).toBe(true);
  });
});
