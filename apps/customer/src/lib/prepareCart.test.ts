import { describe, it, expect, vi, beforeEach } from 'vitest';

// The data layer decides live-vs-mock at import time, so both it and the
// backend flag are mocked per-case.
const mockPrepareCart = vi.fn();
let live = true;

vi.mock('../data', () => ({
  get isBackendLive() {
    return live;
  },
  db: { orders: { prepareCart: (...a: unknown[]) => mockPrepareCart(...a) } },
}));

import { prepareReorder } from './prepareCart';
import type { CartItem, MenuItem } from '../data/types';

const past: CartItem[] = [
  {
    lineId: 'line-1',
    itemId: 'item-1',
    restaurantId: 'rest-1',
    name: 'Koshary (old name)',
    basePriceEgp: 50,
    image: 'old.png',
    quantity: 2,
    modifierChoices: [
      { modifierId: 'm1', modifierName: 'Size', optionId: 'o1', optionName: 'Large', priceDeltaEgp: 10 },
    ],
    notes: 'no onions',
    allergens: ['nuts'],
  },
];

const menu: MenuItem[] = [
  {
    id: 'item-1',
    name: 'Koshary',
    description: '',
    priceEgp: 50,
    image: 'new.png',
    isAvailable: true,
    modifiers: [
      {
        id: 'm1',
        name: 'Size',
        required: false,
        minSelect: 0,
        maxSelect: 1,
        options: [{ id: 'o1', name: 'Large', priceDeltaEgp: 10 }],
      },
    ],
  } as unknown as MenuItem,
];

function serverResponse(over: Record<string, unknown> = {}) {
  return {
    restaurantId: 'rest-1',
    restaurantOpen: true,
    minimumOrderEgp: 100,
    subtotalEgp: 120,
    lines: [
      {
        index: 0,
        itemId: 'item-1',
        name: 'Koshary',
        image: 'new.png',
        unitPriceEgp: 50,
        quantity: 2,
        modifierChoices: [
          {
            modifierId: 'm1',
            modifierName: 'Size',
            optionId: 'o1',
            optionName: 'Large',
            priceDeltaEgp: 10,
          },
        ],
        lineTotalEgp: 120,
        notes: 'no onions',
      },
    ],
    issues: [],
    ...over,
  };
}

beforeEach(() => {
  live = true;
  mockPrepareCart.mockReset();
});

describe('server path', () => {
  it('uses the server when the backend is live', async () => {
    mockPrepareCart.mockResolvedValue(serverResponse());
    const r = await prepareReorder('rest-1', past, menu);
    expect(r.source).toBe('server');
    expect(mockPrepareCart).toHaveBeenCalledWith('rest-1', past);
  });

  it('surfaces store state the client cannot determine', async () => {
    mockPrepareCart.mockResolvedValue(serverResponse({ restaurantOpen: false }));
    const r = await prepareReorder('rest-1', past, menu);
    expect(r.restaurantOpen).toBe(false);
    expect(r.minimumOrderEgp).toBe(100);
  });

  it('preserves the customer OWN data across the round trip', async () => {
    // notes/quantity/allergens are the customer's input, not menu data. The
    // server does not store allergens at all, so they must be carried over
    // from the past order or they are silently lost.
    mockPrepareCart.mockResolvedValue(serverResponse());
    const r = await prepareReorder('rest-1', past, menu);
    expect(r.lines[0].notes).toBe('no onions');
    expect(r.lines[0].quantity).toBe(2);
    expect(r.lines[0].allergens).toEqual(['nuts']);
  });

  it('keeps the original lineId so cart edits stay stable', async () => {
    mockPrepareCart.mockResolvedValue(serverResponse());
    const r = await prepareReorder('rest-1', past, menu);
    expect(r.lines[0].lineId).toBe('line-1');
  });

  it('refreshes display fields from the live menu', async () => {
    mockPrepareCart.mockResolvedValue(serverResponse());
    const r = await prepareReorder('rest-1', past, menu);
    expect(r.lines[0].name).toBe('Koshary'); // not "Koshary (old name)"
    expect(r.lines[0].image).toBe('new.png');
  });

  it('reports a price rise by comparing against what the past order paid', async () => {
    mockPrepareCart.mockResolvedValue(
      serverResponse({
        lines: [{ ...serverResponse().lines[0], unitPriceEgp: 60, lineTotalEgp: 140 }],
      }),
    );
    const r = await prepareReorder('rest-1', past, menu);
    const change = r.changes.find((c) => c.kind === 'price_up');
    expect(change).toBeDefined();
    expect(change?.oldPriceEgp).toBe(60); // 50 + 10
    expect(change?.newPriceEgp).toBe(70); // 60 + 10
  });

  it('translates server issue codes into the UI vocabulary', async () => {
    mockPrepareCart.mockResolvedValue(
      serverResponse({
        lines: [],
        issues: [{ code: 'ITEM_UNAVAILABLE', index: 0, itemId: 'item-1', name: 'Koshary' }],
      }),
    );
    const r = await prepareReorder('rest-1', past, menu);
    expect(r.changes[0].kind).toBe('unavailable');
    expect(r.allGone).toBe(true);
  });

  it('does NOT scare the user about a non-blocking required modifier', async () => {
    // place_order accepts this cart, so reporting it as "changed" would
    // misrepresent a basket that is going to work.
    mockPrepareCart.mockResolvedValue(
      serverResponse({
        issues: [
          { code: 'REQUIRED_MODIFIER_MISSING', index: 0, itemId: 'item-1', name: 'Koshary' },
        ],
      }),
    );
    const r = await prepareReorder('rest-1', past, menu);
    expect(r.changes).toEqual([]);
  });
});

describe('client fallback', () => {
  it('falls back when the RPC throws (offline)', async () => {
    mockPrepareCart.mockRejectedValue(new Error('network'));
    const r = await prepareReorder('rest-1', past, menu);
    expect(r.source).toBe('client');
    expect(r.lines).toHaveLength(1);
  });

  it('never throws out of a reorder — the highest-intent tap must not error', async () => {
    mockPrepareCart.mockRejectedValue(new Error('boom'));
    await expect(prepareReorder('rest-1', past, menu)).resolves.toBeDefined();
  });

  it('uses the client path in mock mode without calling the RPC', async () => {
    live = false;
    const r = await prepareReorder('rest-1', past, menu);
    expect(r.source).toBe('client');
    expect(mockPrepareCart).not.toHaveBeenCalled();
  });

  it('still reconciles correctly on the fallback path', async () => {
    live = false;
    const soldOut = [{ ...menu[0], isAvailable: false }] as MenuItem[];
    const r = await prepareReorder('rest-1', past, soldOut);
    expect(r.allGone).toBe(true);
    expect(r.changes[0].kind).toBe('unavailable');
  });
});
