import { describe, it, expect, beforeEach, vi } from 'vitest';

// AsyncStorage is a native module; mock it so the store is testable in Node.
// vi.mock is hoisted above the imports below by Vitest, so the store picks up
// the mock at import time.
const store: Record<string, string> = {};
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn(async (k: string) => store[k] ?? null),
    setItem: vi.fn(async (k: string, v: string) => {
      store[k] = v;
    }),
    removeItem: vi.fn(async (k: string) => {
      delete store[k];
    }),
  },
}));

import { useCart } from './cart';

const STORAGE_KEY = '@sharmeats:cart:v1';

describe('cart hydrate — corrupt/old-format storage must not crash', () => {
  beforeEach(() => {
    for (const k of Object.keys(store)) delete store[k];
    useCart.setState({ restaurantId: null, restaurantName: null, lines: [], hydrated: false });
  });

  it('hydrates a valid stored cart', async () => {
    store[STORAGE_KEY] = JSON.stringify({
      restaurantId: 'r1',
      restaurantName: 'Test',
      lines: [{ lineId: 'l1', itemId: 'i1', name: 'X', basePriceEgp: 10, quantity: 2, modifierChoices: [] }],
    });
    await useCart.getState().hydrate();
    const s = useCart.getState();
    expect(s.hydrated).toBe(true);
    expect(Array.isArray(s.lines)).toBe(true);
    expect(s.count()).toBe(2);
  });

  it('coerces a non-array `lines` to [] (the TabBar-crash guard)', async () => {
    // Old-format / corrupt data: valid JSON, but lines is not an array.
    store[STORAGE_KEY] = JSON.stringify({ restaurantId: 'r1', restaurantName: 'Test', lines: { bad: true } });
    await useCart.getState().hydrate();
    const s = useCart.getState();
    expect(Array.isArray(s.lines)).toBe(true);
    expect(s.lines).toEqual([]);
    // count()/subtotal() reduce over lines — must not throw on a non-array source.
    expect(() => s.count()).not.toThrow();
    expect(s.count()).toBe(0);
    expect(s.subtotal()).toBe(0);
  });

  it('handles missing `lines` key entirely', async () => {
    store[STORAGE_KEY] = JSON.stringify({ restaurantId: 'r1', restaurantName: 'Test' });
    await useCart.getState().hydrate();
    expect(Array.isArray(useCart.getState().lines)).toBe(true);
  });

  it('handles invalid JSON without throwing', async () => {
    store[STORAGE_KEY] = '{not valid json';
    await expect(useCart.getState().hydrate()).resolves.not.toThrow();
    expect(useCart.getState().hydrated).toBe(true);
    expect(Array.isArray(useCart.getState().lines)).toBe(true);
  });

  it('handles empty storage (first launch)', async () => {
    await useCart.getState().hydrate();
    expect(useCart.getState().hydrated).toBe(true);
    expect(useCart.getState().lines).toEqual([]);
  });
});
