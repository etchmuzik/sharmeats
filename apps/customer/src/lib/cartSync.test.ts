/**
 * Server-cart sync decisions (Package 02 Slice D).
 *
 * The interesting behaviour here is not "does it upload a cart" — it is what
 * happens when two devices disagree. The product rule is that a disagreement is
 * ALWAYS shown to the customer, including when both carts are from the same
 * restaurant, because silently adopting the newer cart discards whatever the
 * other device added and a silently shorter basket reads as a bug.
 *
 * These tests pin that rule down, plus the identity-only comparison (a price
 * change is not a reason to write) and the TTL edge cases.
 */
import { describe, it, expect } from 'vitest';
import { decideRestore, isStale, sameAsServer, toServerLines } from './cartSync';
import type { CartItem, ServerCart, ServerCartLine } from '../data/types';

function line(over: Partial<CartItem> = {}): CartItem {
  return {
    lineId: 'l-1',
    itemId: 'i-1',
    restaurantId: 'r-1',
    name: 'Koshari',
    basePriceEgp: 60,
    image: '',
    quantity: 1,
    modifierChoices: [],
    ...over,
  };
}

function serverCart(over: Partial<ServerCart> = {}): ServerCart {
  return {
    restaurantId: 'r-1',
    lines: [{ itemId: 'i-1', quantity: 1, modifierOptionIds: [] }],
    version: 3,
    updatedAt: '2026-07-29T10:00:00.000Z',
    // Far future by default so tests opt in to staleness explicitly.
    expiresAt: '2099-01-01T00:00:00.000Z',
    ...over,
  };
}

describe('toServerLines', () => {
  it('sends identity only — never a price', () => {
    const out = toServerLines([
      line({
        basePriceEgp: 999,
        modifierChoices: [{ optionId: 'o-1', modifierId: 'm-1', modifierName: 'Size', optionName: 'Extra', priceDeltaEgp: 15 }],
        notes: 'spicy',
      }),
    ]);
    expect(out).toEqual([
      { itemId: 'i-1', quantity: 1, modifierOptionIds: ['o-1'], notes: 'spicy' },
    ]);
    // The guard that matters: no price field of any kind leaves the client.
    const serialised = JSON.stringify(out);
    expect(serialised).not.toContain('999');
    expect(serialised).not.toContain('priceDelta');
    expect(serialised).not.toContain('basePrice');
  });

  it('omits allergens — a customer annotation, not menu data the server stores', () => {
    const out = toServerLines([line({ allergens: ['nuts'] })]);
    expect(JSON.stringify(out)).not.toContain('nuts');
  });
});

describe('sameAsServer', () => {
  it('treats an identical basket as in sync', () => {
    expect(sameAsServer([line()], [{ itemId: 'i-1', quantity: 1, modifierOptionIds: [] }])).toBe(
      true,
    );
  });

  it('ignores a local price change — prices are not stored server-side', () => {
    const local = [line({ basePriceEgp: 75 })];
    expect(sameAsServer(local, [{ itemId: 'i-1', quantity: 1, modifierOptionIds: [] }])).toBe(true);
  });

  it('detects a quantity change', () => {
    expect(sameAsServer([line({ quantity: 2 })], [{ itemId: 'i-1', quantity: 1, modifierOptionIds: [] }])).toBe(
      false,
    );
  });

  it('detects a notes change', () => {
    expect(
      sameAsServer([line({ notes: 'no onion' })], [{ itemId: 'i-1', quantity: 1, modifierOptionIds: [] }]),
    ).toBe(false);
  });

  it('compares modifiers as a set, since their order is not customer-visible', () => {
    const local = [
      line({
        modifierChoices: [
          { optionId: 'o-2', modifierId: 'm-1', modifierName: 'M', optionName: 'B', priceDeltaEgp: 0 },
          { optionId: 'o-1', modifierId: 'm-1', modifierName: 'M', optionName: 'A', priceDeltaEgp: 0 },
        ],
      }),
    ];
    const server: ServerCartLine[] = [
      { itemId: 'i-1', quantity: 1, modifierOptionIds: ['o-1', 'o-2'] },
    ];
    expect(sameAsServer(local, server)).toBe(true);
  });

  it('detects a different modifier selection', () => {
    const local = [
      line({ modifierChoices: [{ optionId: 'o-9', modifierId: 'm-1', modifierName: 'M', optionName: 'X', priceDeltaEgp: 0 }] }),
    ];
    expect(sameAsServer(local, [{ itemId: 'i-1', quantity: 1, modifierOptionIds: ['o-1'] }])).toBe(
      false,
    );
  });

  it('treats a reordered basket as different, because the customer sees that order', () => {
    const local = [line({ itemId: 'i-2' }), line({ itemId: 'i-1' })];
    const server: ServerCartLine[] = [
      { itemId: 'i-1', quantity: 1, modifierOptionIds: [] },
      { itemId: 'i-2', quantity: 1, modifierOptionIds: [] },
    ];
    expect(sameAsServer(local, server)).toBe(false);
  });
});

describe('isStale', () => {
  const now = Date.parse('2026-07-29T12:00:00.000Z');

  it('is false before the horizon', () => {
    expect(isStale({ expiresAt: '2026-07-30T00:00:00.000Z' }, now)).toBe(false);
  });

  it('is true after the horizon', () => {
    expect(isStale({ expiresAt: '2026-07-28T00:00:00.000Z' }, now)).toBe(true);
  });

  it('treats an unparseable date as stale rather than silently fresh', () => {
    // Fail safe: the customer gets asked instead of handed a basket of unknown age.
    expect(isStale({ expiresAt: 'not-a-date' }, now)).toBe(true);
  });
});

describe('decideRestore', () => {
  const localEmpty = { restaurantId: null, lines: [] as CartItem[] };
  const localFilled = { restaurantId: 'r-1', lines: [line({ quantity: 2 })] };

  it('keeps the local cart when the server has none', () => {
    expect(decideRestore(localFilled, null).kind).toBe('keep_local');
  });

  it('keeps the local cart when the server cart is empty', () => {
    expect(decideRestore(localFilled, serverCart({ lines: [] })).kind).toBe('keep_local');
  });

  it('adopts the server cart when nothing is in the local one', () => {
    const d = decideRestore(localEmpty, serverCart());
    expect(d.kind).toBe('adopt_server');
    if (d.kind === 'adopt_server') expect(d.stale).toBe(false);
  });

  it('reports in_sync when both hold the same basket', () => {
    const d = decideRestore({ restaurantId: 'r-1', lines: [line()] }, serverCart());
    expect(d.kind).toBe('in_sync');
  });

  it('ASKS when both carts differ — even from the SAME restaurant', () => {
    // The core product rule. Auto-taking the newer cart here would silently drop
    // the other device's additions.
    const d = decideRestore(localFilled, serverCart());
    expect(d.kind).toBe('ask');
    if (d.kind === 'ask') expect(d.sameRestaurant).toBe(true);
  });

  it('asks and flags a cross-restaurant conflict', () => {
    const d = decideRestore(localFilled, serverCart({ restaurantId: 'r-OTHER' }));
    expect(d.kind).toBe('ask');
    if (d.kind === 'ask') expect(d.sameRestaurant).toBe(false);
  });

  it('flags staleness on an expired server cart instead of discarding it', () => {
    const d = decideRestore(localEmpty, serverCart({ expiresAt: '2020-01-01T00:00:00.000Z' }));
    expect(d.kind).toBe('adopt_server');
    if (d.kind === 'adopt_server') expect(d.stale).toBe(true);
  });

  it('treats a same-lines/different-restaurant pair as a conflict, not in sync', () => {
    // Guards against comparing lines while ignoring the restaurant: identical
    // item ids across two merchants would otherwise look "in sync".
    const d = decideRestore(
      { restaurantId: 'r-OTHER', lines: [line()] },
      serverCart({ restaurantId: 'r-1' }),
    );
    expect(d.kind).toBe('ask');
  });
});
