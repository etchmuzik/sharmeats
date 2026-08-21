import { beforeEach, describe, expect, it, vi } from 'vitest';

let rows: Record<string, unknown>[] = [];

vi.mock('./client', () => ({
  getSupabase: () => {
    // Real PostgREST builders are thenable at every chain stage — list() ends
    // on .order() while listFeatured() ends on .eq(), so the mock must resolve
    // wherever it is awaited.
    const builder = {
      select: () => builder,
      eq: () => builder,
      contains: () => builder,
      ilike: () => builder,
      order: () => builder,
      then: (resolve: (v: { data: unknown; error: null }) => unknown) =>
        Promise.resolve({ data: rows, error: null }).then(resolve),
    };
    return { from: () => builder };
  },
}));

import { RESTAURANT_COLUMNS, restaurantsRepoSupabase } from './restaurants';

/** A row carrying every selected column, so rowToRestaurant maps it fully. */
function sampleRow(id: string, verticalId: string): Record<string, unknown> {
  const row: Record<string, unknown> = {};
  for (const col of RESTAURANT_COLUMNS.split(',').map((c) => c.trim())) {
    row[col] = {
      id,
      slug: `slug-${id}`,
      name: `Merchant ${id}`,
      description: 'd',
      cuisines: ['seafood'],
      cuisine_label: 'Seafood',
      cover_image: 'https://example.com/x.jpg',
      logo: null,
      zone: 'naama',
      rating: 4.5,
      rating_count: 10,
      prep_time_low: 10,
      prep_time_high: 30,
      delivery_fee_egp: 25,
      min_order_egp: 0,
      distance_meters: 0,
      tourist_safe: false,
      is_open: true,
      is_open_24h: false,
      promo: null,
      featured: false,
      phone: null,
      address: null,
      website: null,
      merchant_type: 'third_party',
      vertical_id: verticalId,
    }[col];
  }
  return row;
}

beforeEach(() => {
  rows = [];
});

describe('restaurantsRepoSupabase.list vertical scoping', () => {
  it('defaults to food, so pre-verticals callers never see other verticals', async () => {
    rows = [sampleRow('a', 'food'), sampleRow('b', 'pharmacy')];

    const out = await restaurantsRepoSupabase.list();

    expect(out.map((r) => r.id)).toEqual(['a']);
  });

  it('returns only the requested vertical when one is passed', async () => {
    rows = [sampleRow('a', 'food'), sampleRow('b', 'pharmacy'), sampleRow('c', 'grocery')];

    const out = await restaurantsRepoSupabase.list({ verticalId: 'pharmacy' });

    expect(out.map((r) => r.id)).toEqual(['b']);
  });

  it('keeps the featured rail a food surface regardless of grants', async () => {
    rows = [sampleRow('a', 'food'), sampleRow('b', 'grocery')];

    const out = await restaurantsRepoSupabase.listFeatured();

    expect(out.map((r) => r.id)).toEqual(['a']);
  });
});
