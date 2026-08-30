import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CreateOrderInput } from '../repositories/orders';
import type { PaymentMethodKind } from '../types';

const mocks = vi.hoisted(() => {
  const rpc = vi.fn();
  const getUser = vi.fn();
  return { rpc, getUser };
});

// orders.ts imports i18n only for its server-error mapper. Keep this payment
// boundary test independent of React Native and the translation catalogue.
vi.mock('../../i18n', () => ({ t: (key: string) => key }));

vi.mock('./client', () => ({
  getSupabase: () => ({
    auth: { getUser: mocks.getUser },
    rpc: mocks.rpc,
  }),
}));

const { ordersRepoSupabase } = await import('./orders');

const input: CreateOrderInput = {
  restaurantId: 'restaurant-1',
  restaurantName: 'Restaurant',
  items: [],
  address: { id: 'address-1', kind: 'hotel', label: 'Hotel' },
  payment: { kind: 'cash', label: 'Cash on delivery' },
  deliveryFeeEgp: 30,
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getUser.mockResolvedValue({ data: { user: { id: 'customer-1' } } });
});

describe('Supabase order payment conversion', () => {
  it.each<PaymentMethodKind>(['fawry', 'vodafone_cash', 'instapay', 'card', 'apple_pay'])(
    'rejects persisted %s before invoking place_order in cash-only mode',
    async (kind) => {
      await expect(
        ordersRepoSupabase.create({
          ...input,
          payment: { kind, label: kind },
        }),
      ).rejects.toThrow(/not available/i);

      expect(mocks.rpc).not.toHaveBeenCalled();
    },
  );
});
