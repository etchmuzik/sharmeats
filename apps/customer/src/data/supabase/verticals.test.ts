import { beforeEach, describe, expect, it, vi } from 'vitest';

let rows: unknown[] = [];
const selectCalls: string[] = [];
const eqCalls: { column: string; value: unknown }[] = [];
const orderCalls: string[] = [];

vi.mock('./client', () => ({
  getSupabase: () => ({
    from: () => {
      const builder = {
        select: (cols: string) => {
          selectCalls.push(cols);
          return builder;
        },
        eq: (column: string, value: unknown) => {
          eqCalls.push({ column, value });
          return builder;
        },
        order: (column: string) => {
          orderCalls.push(column);
          // Two chained .order() calls — resolve on the second, keep chaining.
          return orderCalls.length >= 2
            ? Promise.resolve({ data: rows, error: null })
            : builder;
        },
      };
      return builder;
    },
  }),
}));

import { verticalsRepoSupabase } from './verticals';

beforeEach(() => {
  rows = [];
  selectCalls.length = 0;
  eqCalls.length = 0;
  orderCalls.length = 0;
});

describe('verticalsRepoSupabase.list', () => {
  it('maps rows to the Vertical shape, normalizing a null icon', async () => {
    rows = [
      { id: 'food', name_en: 'Food', name_ar: 'طعام', icon: 'utensils' },
      { id: 'pharmacy', name_en: 'Pharmacy', name_ar: 'صيدلية', icon: null },
    ];

    const out = await verticalsRepoSupabase.list();

    expect(out).toEqual([
      { id: 'food', nameEn: 'Food', nameAr: 'طعام', icon: 'utensils' },
      { id: 'pharmacy', nameEn: 'Pharmacy', nameAr: 'صيدلية', icon: undefined },
    ]);
  });

  it('asks for a closed column list, filters active rows, and orders deterministically', async () => {
    // The verticals_public_read policy decides WHICH rows come back — the
    // client must not re-derive visibility, only shape. A wildcard here would
    // silently widen with future columns, the same failure RESTAURANT_COLUMNS
    // guards against.
    await verticalsRepoSupabase.list();

    expect(selectCalls).toHaveLength(1);
    expect(selectCalls[0]).not.toContain('*');
    expect(selectCalls[0].split(',').map((c) => c.trim()).sort()).toEqual([
      'icon',
      'id',
      'name_ar',
      'name_en',
    ]);
    expect(eqCalls).toEqual([{ column: 'is_active', value: true }]);
    expect(orderCalls).toEqual(['display_order', 'id']);
  });
});
