/**
 * Restoring a stored server cart (Package 02 Slice D).
 *
 * The rule under test is that a server cart is NEVER loaded straight into the
 * basket: the stored row has no prices (mig 168 has no column for them), so the
 * only honest way to display it is to ask prepare_cart for today's values. These
 * tests assert that the prepare path is actually taken, that a failure leaves
 * the caller's basket alone, and that a vertical denial is not treated as an
 * outage.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({
  prepareCalls: [] as Array<{ restaurantId: string; itemIds: string[] }>,
  prepareImpl: null as null | (() => unknown),
  restaurant: { id: 'r1', name: 'Fish Market', minOrderEgp: 50 } as unknown,
}));

vi.mock('../data', () => ({
  isBackendLive: true,
  db: {
    restaurants: { get: vi.fn(async () => h.restaurant) },
    menus: { forRestaurant: vi.fn(async () => ({ items: [] })) },
  },
}));

vi.mock('./prepareCart', () => ({
  isVerticalDenial: (e: unknown) =>
    typeof (e as Error)?.message === 'string' &&
    ((e as Error).message.includes('VERTICAL_NOT_AVAILABLE') ||
      (e as Error).message.includes('MERCHANT_NOT_FOUND')),
  prepareReorder: vi.fn(async (restaurantId: string, past: Array<{ itemId: string }>) => {
    h.prepareCalls.push({ restaurantId, itemIds: past.map((p) => p.itemId) });
    if (h.prepareImpl) return h.prepareImpl();
    return {
      lines: past.map((p, i) => ({
        lineId: `l${i}`,
        itemId: p.itemId,
        restaurantId,
        name: 'Sea Bass',
        basePriceEgp: 220,
        image: '',
        quantity: 1,
        modifierChoices: [],
      })),
      changes: [],
      allGone: false,
      source: 'server',
      restaurantOpen: true,
      minimumOrderEgp: 50,
    };
  }),
}));

import { restoreServerCart, restoreFailureReason } from './cartRestore';
import type { ServerCart } from '../data/types';

function cart(over: Partial<ServerCart> = {}): ServerCart {
  return {
    restaurantId: 'r1',
    lines: [{ itemId: 'i1', quantity: 2, modifierOptionIds: ['o1'] }],
    version: 5,
    updatedAt: '2026-07-29T10:00:00.000Z',
    expiresAt: '2099-01-01T00:00:00.000Z',
    ...over,
  };
}

beforeEach(() => {
  h.prepareCalls.length = 0;
  h.prepareImpl = null;
  h.restaurant = { id: 'r1', name: 'Fish Market', minOrderEgp: 50 };
});

describe('restoreServerCart', () => {
  it('routes the stored cart through prepare_cart rather than loading it directly', async () => {
    await restoreServerCart(cart());
    expect(h.prepareCalls).toHaveLength(1);
    expect(h.prepareCalls[0]).toEqual({ restaurantId: 'r1', itemIds: ['i1'] });
  });

  it('returns lines priced at TODAY, not at zero', async () => {
    const out = await restoreServerCart(cart());
    // The stub sent in carries basePriceEgp 0; what comes back must be the
    // prepared price. A 0 here would mean the stub leaked through to the basket.
    expect(out.lines[0]?.basePriceEgp).toBe(220);
    expect(out.restaurantName).toBe('Fish Market');
  });

  it('carries the chosen modifier option ids into the prepare call', async () => {
    // Losing these would silently rebuild a plain item from a customised one.
    let seen: string[] = [];
    h.prepareImpl = () => {
      throw new Error('stop');
    };
    const spy = await import('./prepareCart');
    (spy.prepareReorder as ReturnType<typeof vi.fn>).mockImplementationOnce(
      async (_r: string, past: Array<{ modifierChoices: Array<{ optionId: string }> }>) => {
        seen = past[0].modifierChoices.map((c) => c.optionId);
        return {
          lines: [],
          changes: [],
          allGone: false,
          source: 'server',
          restaurantOpen: true,
          minimumOrderEgp: 0,
        };
      },
    );
    await restoreServerCart(cart());
    expect(seen).toEqual(['o1']);
  });

  it('reports dropped lines when the menu no longer has them', async () => {
    h.prepareImpl = () => ({
      lines: [],
      changes: [{ kind: 'removed', itemId: 'i1', name: 'Gone' }],
      allGone: true,
      source: 'server',
      restaurantOpen: true,
      minimumOrderEgp: 50,
    });
    const out = await restoreServerCart(cart());
    expect(out.droppedCount).toBe(1);
    expect(out.changed).toBe(true);
  });

  it('does NOT report a price change — the stub price is 0, so every line would look changed', async () => {
    h.prepareImpl = () => ({
      lines: [
        {
          lineId: 'l0',
          itemId: 'i1',
          restaurantId: 'r1',
          name: 'X',
          basePriceEgp: 220,
          image: '',
          quantity: 1,
          modifierChoices: [],
        },
      ],
      changes: [{ kind: 'price_up', itemId: 'i1', name: 'X', oldPriceEgp: 0, newPriceEgp: 220 }],
      allGone: false,
      source: 'server',
      restaurantOpen: true,
      minimumOrderEgp: 50,
    });
    const out = await restoreServerCart(cart());
    // Warning about a "price rise" from a placeholder zero would be a lie.
    expect(out.changed).toBe(false);
  });

  it('throws on an empty cart instead of returning an empty basket', async () => {
    await expect(restoreServerCart(cart({ lines: [] }))).rejects.toThrow('CART_EMPTY');
  });

  it('throws when the merchant no longer exists', async () => {
    h.restaurant = null;
    await expect(restoreServerCart(cart())).rejects.toThrow('MERCHANT_NOT_FOUND');
  });

  it('surfaces store state so the caller can block checkout on a closed shop', async () => {
    h.prepareImpl = () => ({
      lines: [],
      changes: [],
      allGone: false,
      source: 'server',
      restaurantOpen: false,
      minimumOrderEgp: 120,
    });
    const out = await restoreServerCart(cart());
    expect(out.restaurantOpen).toBe(false);
    expect(out.minimumOrderEgp).toBe(120);
  });
});

describe('restoreFailureReason', () => {
  it('maps a vertical denial to a bounded reason', () => {
    expect(restoreFailureReason(new Error('VERTICAL_NOT_AVAILABLE'))).toBe('denied');
  });

  it('maps the empty and missing-merchant cases', () => {
    expect(restoreFailureReason(new Error('CART_EMPTY'))).toBe('empty');
    // MERCHANT_NOT_FOUND is also a denial code, and denial wins — it is the more
    // important signal (a hidden merchant, not merely a deleted one).
    expect(restoreFailureReason(new Error('MERCHANT_NOT_FOUND'))).toBe('denied');
  });

  it('never leaks the raw error text into analytics', () => {
    const reason = restoreFailureReason(new Error('room 214, guest Ahmed, +20100 secret'));
    expect(reason).toBe('unavailable');
    expect(reason).not.toContain('214');
  });
});
