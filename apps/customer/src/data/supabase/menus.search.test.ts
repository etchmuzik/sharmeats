import { beforeEach, describe, expect, it, vi } from 'vitest';

let rpcRows: unknown[] = [];
let hydratedRows: unknown[] = [];
let flagPages: unknown[][] = [];
const rpcCalls: { name: string; args: Record<string, unknown> }[] = [];
const inCalls: { column: string; values: string[] }[] = [];
const gtCalls: { column: string; value: string }[] = [];
const limitCalls: number[] = [];

vi.mock('./client', () => ({
  getSupabase: () => ({
    rpc: (name: string, args: Record<string, unknown>) => {
      rpcCalls.push({ name, args });
      return Promise.resolve({ data: rpcRows, error: null });
    },
    from: () => {
      const builder = {
        select: () => builder,
        eq: () => builder,
        contains: () => builder,
        order: () => builder,
        gt: (column: string, value: string) => {
          gtCalls.push({ column, value });
          return builder;
        },
        limit: (limit: number) => {
          limitCalls.push(limit);
          return Promise.resolve({
            data: flagPages[limitCalls.length - 1] ?? [],
            error: null,
          });
        },
        in: (column: string, values: string[]) => {
          inCalls.push({ column, values });
          return Promise.resolve({ data: hydratedRows, error: null });
        },
      };
      return builder;
    },
  }),
}));

import { menusRepoSupabase } from './menus';

const row = (id: string, restaurantId: string) => ({
  id,
  restaurant_id: restaurantId,
  section_id: 'section',
  name: `Item ${id}`,
  description: '',
  price_egp: 100,
  image: '',
  flags: [],
  is_available: true,
});

beforeEach(() => {
  rpcRows = [];
  hydratedRows = [];
  flagPages = [];
  rpcCalls.length = 0;
  inCalls.length = 0;
  gtCalls.length = 0;
  limitCalls.length = 0;
});

describe('menusRepoSupabase.search', () => {
  it('uses search_catalog, keeps text literal, hydrates only visible IDs, and restores order', async () => {
    rpcRows = [{ item_id: 'b' }, { item_id: 'a' }];
    hydratedRows = [row('a', 'r-a'), row('b', 'r-b')];

    const result = await menusRepoSupabase.search('50%_*off', 12);

    expect(rpcCalls).toEqual([
      {
        name: 'search_catalog',
        args: expect.objectContaining({ p_query: String.raw`50\%\_\*off`, p_limit: 12 }),
      },
    ]);
    expect(inCalls).toEqual([{ column: 'id', values: ['b', 'a'] }]);
    expect(result.map((item) => item.id)).toEqual(['b', 'a']);
  });

  it('drops sold-out items so Browse matches the mock and forRestaurant contract', async () => {
    // search_catalog returns is_available for the caller to act on rather than
    // filtering server-side (mig 188), so the repository owns the 86 filter.
    rpcRows = [{ item_id: 'a' }, { item_id: 'b' }];
    hydratedRows = [
      row('a', 'r-a'),
      { ...row('b', 'r-b'), is_available: false },
    ];

    const result = await menusRepoSupabase.search('kosh', 12);

    expect(result.map((item) => item.id)).toEqual(['a']);
  });
});

describe('menusRepoSupabase.restaurantIdsForFlags', () => {
  it('uses an ID keyset until an empty page, independent of response cap', async () => {
    flagPages = [
      [
        { id: 'item-a', restaurant_id: 'r-1' },
        { id: 'item-b', restaurant_id: 'r-2' },
      ],
      [{ id: 'item-c', restaurant_id: 'r-3' }],
      [],
    ];

    const ids = await menusRepoSupabase.restaurantIdsForFlags([
      'vegetarian',
      'glutenfree',
    ]);

    expect(limitCalls).toEqual([250, 250, 250]);
    expect(gtCalls).toEqual([
      { column: 'id', value: 'item-b' },
      { column: 'id', value: 'item-c' },
    ]);
    expect([...ids]).toEqual(['r-1', 'r-2', 'r-3']);
  });
});
