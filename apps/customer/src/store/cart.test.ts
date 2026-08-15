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

// The store gained a `../data` import when server-cart sync landed (Slice D).
// That module pulls in the Supabase client and therefore `react-native`, which
// Vitest cannot parse — so it is mocked here. The mocks double as the assertion
// surface for "did the store call the server, and with what".
//
// `isBackendLive: true` so the sync path actually runs; with the real default
// (mock backend) every server call would be skipped and these tests would pass
// while asserting nothing.
const h = vi.hoisted(() => ({
  calls: [] as string[],
  upsertResult: { ok: true, version: 1, updatedAt: '', expiresAt: '' } as
    | { ok: true; version: number; updatedAt: string; expiresAt: string }
    | { ok: false; conflict: true },
}));

vi.mock('../data', () => ({
  isBackendLive: true,
  db: {
    cart: {
      get: vi.fn(async () => {
        h.calls.push('cart.get');
        return null;
      }),
      upsert: vi.fn(async () => {
        h.calls.push('cart.upsert');
        return h.upsertResult;
      }),
      clear: vi.fn(async () => {
        h.calls.push('cart.clear');
      }),
    },
  },
}));

vi.mock('../lib/analytics', () => ({ track: vi.fn() }));

import { useCart } from './cart';

const STORAGE_KEY = '@sharmeats:cart:v1';

const LINE = {
  itemId: 'i1',
  restaurantId: 'r1',
  restaurantName: 'Test',
  name: 'X',
  basePriceEgp: 10,
  image: '',
  quantity: 1,
  modifierChoices: [],
};

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

/**
 * Slice D — the local/server clear distinction.
 *
 * This is the invariant most at risk of being "simplified" away later: `clear()`
 * and `clearEverywhere()` look redundant until you remember that identity
 * teardown calls the former on every sign-out. If `clear()` ever starts deleting
 * the server row, handing a phone to a friend silently destroys the owner's
 * basket on all their other devices.
 */
describe('cart clear — local vs server', () => {
  beforeEach(() => {
    for (const k of Object.keys(store)) delete store[k];
    h.calls.length = 0;
    h.upsertResult = { ok: true, version: 1, updatedAt: '', expiresAt: '' };
    useCart.setState({
      restaurantId: 'r1',
      restaurantName: 'Test',
      lines: [{ lineId: 'l1', ...LINE }],
      hydrated: true,
      serverVersion: 4,
    });
  });

  it('clear() empties the basket locally and NEVER calls the server', async () => {
    useCart.getState().clear();
    expect(useCart.getState().lines).toEqual([]);
    expect(useCart.getState().restaurantId).toBeNull();
    // The whole point: sign-out must not delete the account's stored cart.
    expect(h.calls).not.toContain('cart.clear');
  });

  it('clearEverywhere() empties locally AND retires the server row', async () => {
    await useCart.getState().clearEverywhere();
    expect(useCart.getState().lines).toEqual([]);
    expect(h.calls).toContain('cart.clear');
    // Version resets so the next write starts a fresh row rather than colliding.
    expect(useCart.getState().serverVersion).toBe(0);
  });

  it('clearEverywhere() survives a failing server call', async () => {
    const { db } = await import('../data');
    (db.cart.clear as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('offline'));
    // Must not reject: by this point the customer's order is already placed.
    await expect(useCart.getState().clearEverywhere()).resolves.toBeUndefined();
    expect(useCart.getState().lines).toEqual([]);
  });
});

describe('cart server sync', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    for (const k of Object.keys(store)) delete store[k];
    h.calls.length = 0;
    h.upsertResult = { ok: true, version: 7, updatedAt: '', expiresAt: '' };
    useCart.setState({
      restaurantId: null,
      restaurantName: null,
      lines: [],
      hydrated: true,
      serverVersion: 0,
    });
  });

  it('debounces rapid edits into a single write', async () => {
    const add = useCart.getState().add;
    add(LINE);
    add(LINE);
    add(LINE);
    // Nothing yet — the timer has not fired.
    expect(h.calls).not.toContain('cart.upsert');
    await vi.advanceTimersByTimeAsync(1500);
    expect(h.calls.filter((c) => c === 'cart.upsert')).toHaveLength(1);
  });

  it('records the server version returned by an accepted write', async () => {
    useCart.getState().add(LINE);
    await vi.advanceTimersByTimeAsync(1500);
    expect(useCart.getState().serverVersion).toBe(7);
  });

  it('marks the version unknown on conflict instead of overwriting', async () => {
    h.upsertResult = { ok: false, conflict: true };
    useCart.getState().add(LINE);
    await vi.advanceTimersByTimeAsync(1500);
    // -1 = "re-read before writing again". Critically it is NOT the other
    // device's version, which would let the next write clobber their basket.
    expect(useCart.getState().serverVersion).toBe(-1);
  });

  it('keeps the local basket intact when the server write throws', async () => {
    const { db } = await import('../data');
    (db.cart.upsert as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('offline'));
    useCart.getState().add(LINE);
    await vi.advanceTimersByTimeAsync(1500);
    // Offline must never cost the customer their basket.
    expect(useCart.getState().lines).toHaveLength(1);
  });

  it('degrades safely when the RPC does not exist yet (migs 168/169 unapplied)', async () => {
    // This client is shipping BEFORE the migrations are applied to production, so
    // upsert_my_cart genuinely does not exist there and PostgREST answers
    // PGRST202. That must be indistinguishable from being offline: basket intact,
    // no throw, version untouched so a later retry still starts from 0.
    const { db } = await import('../data');
    (db.cart.upsert as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      Object.assign(new Error('Could not find the function public.upsert_my_cart'), {
        code: 'PGRST202',
      }),
    );
    useCart.getState().add(LINE);
    await expect(vi.advanceTimersByTimeAsync(1500)).resolves.not.toThrow();
    expect(useCart.getState().lines).toHaveLength(1);
    expect(useCart.getState().serverVersion).toBe(0);
  });

  it('mirrors an emptied basket, so the other device stops offering it', async () => {
    useCart.setState({
      restaurantId: 'r1',
      restaurantName: 'Test',
      lines: [{ lineId: 'l1', ...LINE }],
      serverVersion: 0,
    });
    h.calls.length = 0;
    useCart.getState().remove('l1');
    await vi.advanceTimersByTimeAsync(1500);
    expect(h.calls).toContain('cart.upsert');
    expect(useCart.getState().lines).toEqual([]);
  });

  it('waits for an in-flight upsert before clearing, so the old write cannot recreate the cart', async () => {
    const { db } = await import('../data');
    let finishUpsert!: (value: typeof h.upsertResult) => void;
    const pendingUpsert = new Promise<typeof h.upsertResult>((resolve) => {
      finishUpsert = resolve;
    });
    (db.cart.upsert as ReturnType<typeof vi.fn>).mockImplementationOnce(async () => {
      h.calls.push('cart.upsert.pending');
      return pendingUpsert;
    });

    useCart.getState().add(LINE);
    await vi.advanceTimersByTimeAsync(1500);
    const clearing = useCart.getState().clearEverywhere();

    expect(h.calls).not.toContain('cart.clear');
    finishUpsert({ ok: true, version: 9, updatedAt: '', expiresAt: '' });
    await clearing;

    expect(h.calls.indexOf('cart.upsert.pending')).toBeLessThan(h.calls.indexOf('cart.clear'));
    expect(useCart.getState().serverVersion).toBe(0);
    expect(useCart.getState().lines).toEqual([]);
  });

  it('adoptPrepared replaces the basket and records the version', () => {
    useCart.getState().adoptPrepared({
      restaurantId: 'r9',
      restaurantName: 'Adopted',
      lines: [{ lineId: 'old-id', ...LINE, itemId: 'i9' }],
      version: 12,
    });
    const s = useCart.getState();
    expect(s.restaurantId).toBe('r9');
    expect(s.serverVersion).toBe(12);
    expect(s.lines).toHaveLength(1);
    // Fresh lineId, like loadFromOrder — a reused id collides on quantity edits.
    expect(s.lines[0]?.lineId).not.toBe('old-id');
  });
});
