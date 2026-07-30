import { beforeEach, describe, expect, it, vi } from 'vitest';

// Covers the service-area gate added to checkout.
//
// The bug this guards: checkout used to treat a successful `quote_delivery_fee`
// as proof the address was deliverable. It is not. That RPC resolves a zone and
// returns a flat rule price — it never reads distance, `max_delivery_radius_m`
// or `in_range`, and falls back to a flat 30 when no rule matches. So an
// out-of-range address priced fine, the Place button unlocked, and `place_order`
// raised OUT_OF_RANGE only after the customer had committed.
//
// `delivery_feasibility` is the only RPC returning `in_range`, and it is the one
// `place_order` itself gates on.

let rpcResponse: { data: unknown; error: unknown } = { data: null, error: null };
let addressRow: { geo: string | null } | null = { geo: 'POINT(34.3 27.9)' };
let addressError: unknown = null;
const rpcCalls: { name: string; args: Record<string, unknown> }[] = [];

// orders.ts imports the i18n module for its error mapper, which reaches into
// react-native. Stubbed so this stays a pure data-layer test.
vi.mock('../../i18n', () => ({ t: (key: string) => key }));

vi.mock('./client', () => ({
  getSupabase: () => ({
    rpc: (name: string, args: Record<string, unknown>) => {
      rpcCalls.push({ name, args });
      return Promise.resolve(rpcResponse);
    },
    from: () => {
      const builder = {
        select: () => builder,
        eq: () => builder,
        maybeSingle: () => Promise.resolve({ data: addressRow, error: addressError }),
      };
      return builder;
    },
  }),
}));

const { ordersRepoSupabase } = await import('./orders');

beforeEach(() => {
  rpcCalls.length = 0;
  addressRow = { geo: 'POINT(34.3 27.9)' };
  addressError = null;
  rpcResponse = { data: null, error: null };
});

describe('checkDeliveryFeasibility', () => {
  it('calls delivery_feasibility — not quote_delivery_fee — with the address geo', async () => {
    rpcResponse = { data: [{ distance_m: 1200, in_range: true, eta_minutes: 35 }], error: null };

    await ordersRepoSupabase.checkDeliveryFeasibility('rest-1', 'addr-1');

    expect(rpcCalls).toHaveLength(1);
    expect(rpcCalls[0].name).toBe('delivery_feasibility');
    expect(rpcCalls[0].args).toEqual({
      p_restaurant_id: 'rest-1',
      p_dropoff: 'POINT(34.3 27.9)',
    });
  });

  it('reports out of range when the server says in_range is false', async () => {
    rpcResponse = { data: [{ distance_m: 21000, in_range: false, eta_minutes: null }], error: null };

    const result = await ordersRepoSupabase.checkDeliveryFeasibility('rest-1', 'addr-1');

    expect(result.inRange).toBe(false);
  });

  it('unwraps the first row of a setof-returning RPC', async () => {
    rpcResponse = { data: [{ distance_m: 800, in_range: true, eta_minutes: 28 }], error: null };

    const result = await ordersRepoSupabase.checkDeliveryFeasibility('rest-1', 'addr-1');

    expect(result).toEqual({ inRange: true, etaMinutes: 28 });
  });

  // The next three all assert the same rule from different angles: ONLY an
  // explicit `false` blocks checkout. This mirrors delivery_feasibility's own
  // fail-open branch (mig 186) — a restaurant or address with no geo returns
  // in_range = true rather than rejecting a real order over missing data.
  // Getting this backwards would block deliverable orders, which is a worse
  // failure than the bug being fixed.
  it('fails OPEN on an empty result set', async () => {
    rpcResponse = { data: [], error: null };

    const result = await ordersRepoSupabase.checkDeliveryFeasibility('rest-1', 'addr-1');

    expect(result.inRange).toBe(true);
  });

  it('fails OPEN when in_range comes back null', async () => {
    rpcResponse = { data: [{ distance_m: null, in_range: null, eta_minutes: 30 }], error: null };

    const result = await ordersRepoSupabase.checkDeliveryFeasibility('rest-1', 'addr-1');

    expect(result.inRange).toBe(true);
  });

  it('fails OPEN when the address has no geo', async () => {
    addressRow = { geo: null };
    rpcResponse = { data: [{ distance_m: null, in_range: true, eta_minutes: 30 }], error: null };

    const result = await ordersRepoSupabase.checkDeliveryFeasibility('rest-1', 'addr-1');

    expect(rpcCalls[0].args.p_dropoff).toBeNull();
    expect(result.inRange).toBe(true);
  });

  // A thrown error must NOT be swallowed into inRange:false — checkout catches
  // it and shows the retry hint instead. Telling someone in Naama Bay we don't
  // deliver to them because their signal dropped is worse than letting
  // place_order decide.
  it('throws on an RPC error rather than reporting out of range', async () => {
    rpcResponse = { data: null, error: { message: 'network down' } };

    await expect(
      ordersRepoSupabase.checkDeliveryFeasibility('rest-1', 'addr-1'),
    ).rejects.toBeTruthy();
  });

  it('throws when the address row cannot be read', async () => {
    addressError = { message: 'rls denied' };

    await expect(
      ordersRepoSupabase.checkDeliveryFeasibility('rest-1', 'addr-1'),
    ).rejects.toBeTruthy();
  });

  it('normalises a missing eta to null rather than NaN or undefined', async () => {
    rpcResponse = { data: [{ distance_m: 900, in_range: true, eta_minutes: null }], error: null };

    const result = await ordersRepoSupabase.checkDeliveryFeasibility('rest-1', 'addr-1');

    expect(result.etaMinutes).toBeNull();
  });
});
