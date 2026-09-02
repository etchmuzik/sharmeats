import { describe, expect, it } from 'vitest';
import type { Restaurant } from '@/lib/types';
import { buildAdminRestaurantDetailsPayload } from './restaurantUpdatePayload';

const restaurant: Restaurant = {
  id: 'restaurant-1',
  slug: 'restaurant-1',
  name: '  Gold venue  ',
  description: 'Description',
  cuisines: ['egyptian'],
  cuisine_label: 'Egyptian',
  cover_image: '  https://example.test/cover.jpg  ',
  logo: null,
  zone: 'naama',
  rating: 4.8,
  rating_count: 10,
  prep_time_low: 15,
  prep_time_high: 25,
  delivery_fee_egp: 20,
  min_order_egp: 50,
  tourist_safe: true,
  is_open: true,
  is_open_24h: false,
  // Gold makes this effective, but no editor has manually promoted it.
  featured: true,
  featured_manual: false,
  promo: null,
  is_active: true,
};

describe('buildAdminRestaurantDetailsPayload', () => {
  it('omits feature state so a stale Gold flag cannot change editorial intent', () => {
    const payload = buildAdminRestaurantDetailsPayload(restaurant);

    expect(payload).not.toHaveProperty('p_featured');
    expect(payload.p_name).toBe('Gold venue');
    expect(payload.p_cover_image).toBe('https://example.test/cover.jpg');
  });
});
