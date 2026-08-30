import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PaymentMethodKind } from '../types';

const mocks = vi.hoisted(() => {
  const getUser = vi.fn();
  const from = vi.fn();
  const select = vi.fn();
  const eq = vi.fn();
  const order = vi.fn();
  const maybeSingle = vi.fn();
  const update = vi.fn();
  return { getUser, from, select, eq, order, maybeSingle, update };
});

vi.mock('./client', () => ({
  getSupabase: () => ({
    auth: { getUser: mocks.getUser },
    from: mocks.from,
  }),
}));

const { userRepoSupabase } = await import('./user');

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getUser.mockResolvedValue({ data: { user: { id: 'customer-1' } } });
  mocks.select.mockReturnValue({ eq: mocks.eq, order: mocks.order });
  mocks.eq.mockReturnValue({ eq: mocks.eq, maybeSingle: mocks.maybeSingle });
  mocks.order.mockResolvedValue({ data: [], error: null });
  mocks.update.mockReturnValue({ eq: mocks.eq });
  mocks.from.mockReturnValue({
    select: mocks.select,
    update: mocks.update,
  });
});

describe('Supabase saved payment selection', () => {
  it('keeps the universal COD choice saveable when the account has no persisted cash row', async () => {
    await expect(userRepoSupabase.setDefaultPaymentMethod('cod-default')).resolves.toEqual([
      expect.objectContaining({ id: 'cod-default', kind: 'cash' }),
    ]);

    expect(mocks.maybeSingle).not.toHaveBeenCalled();
    expect(mocks.update).toHaveBeenNthCalledWith(1, { is_default: false });
    expect(mocks.update).toHaveBeenNthCalledWith(2, { default_payment_method_id: null });
  });

  it.each<PaymentMethodKind>(['fawry', 'vodafone_cash', 'instapay', 'card', 'apple_pay'])(
    'refuses a persisted %s method before changing the default in cash-only mode',
    async (kind) => {
      mocks.maybeSingle.mockResolvedValue({
        data: {
          id: `pm-${kind}`,
          kind,
          label: kind,
          subline: '',
          is_default: true,
        },
        error: null,
      });

      await expect(userRepoSupabase.setDefaultPaymentMethod(`pm-${kind}`)).rejects.toThrow(
        /not available/i,
      );

      expect(mocks.update).not.toHaveBeenCalled();
    },
  );

  it('surfaces a failure when clearing the previous persisted default', async () => {
    mocks.maybeSingle.mockResolvedValue({
      data: {
        id: 'pm-cash',
        kind: 'cash',
        label: 'Cash on delivery',
        subline: '',
        is_default: false,
      },
      error: null,
    });
    const writeError = new Error('could not clear previous default');
    mocks.update.mockImplementationOnce(() => ({
      eq: vi.fn().mockResolvedValue({ error: writeError }),
    }));

    await expect(userRepoSupabase.setDefaultPaymentMethod('pm-cash')).rejects.toBe(writeError);
  });
});
