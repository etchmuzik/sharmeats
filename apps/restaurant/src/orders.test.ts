import { describe, expect, it } from 'vitest';
import {
  allergenLabel,
  isActive,
  isVisible,
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
