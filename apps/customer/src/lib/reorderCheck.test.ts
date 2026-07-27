import { describe, it, expect } from 'vitest';
import { checkReorder } from './reorderCheck';
import type { CartItem, MenuItem } from '../data/types';

const item = (over: Partial<MenuItem> = {}): MenuItem => ({
  id: 'i-1',
  restaurantId: 'r-1',
  sectionId: 's-1',
  name: 'Koshary',
  description: '',
  priceEgp: 100,
  image: 'img',
  flags: [],
  isAvailable: true,
  modifiers: [],
  ...over,
});

const line = (over: Partial<CartItem> = {}): CartItem => ({
  lineId: 'l-1',
  itemId: 'i-1',
  restaurantId: 'r-1',
  name: 'Koshary',
  basePriceEgp: 100,
  image: 'img',
  quantity: 2,
  modifierChoices: [],
  ...over,
});

const withExtra = (priceDeltaEgp: number, optionId = 'o-1'): MenuItem =>
  item({
    modifiers: [
      {
        id: 'm-1',
        name: 'Extras',
        required: false,
        minSelect: 0,
        maxSelect: 1,
        options: [{ id: optionId, name: 'Extra sauce', priceDeltaEgp }],
      },
    ],
  });

const choseExtra = (priceDeltaEgp: number, optionId = 'o-1') =>
  line({
    modifierChoices: [
      { modifierId: 'm-1', modifierName: 'Extras', optionId, optionName: 'Extra sauce', priceDeltaEgp },
    ],
  });

describe('checkReorder — clean case', () => {
  it('reports no changes when the menu is unchanged', () => {
    const r = checkReorder([line()], [item()]);
    expect(r.changes).toEqual([]);
    expect(r.lines).toHaveLength(1);
    expect(r.allGone).toBe(false);
  });

  it('carries over the customer’s own input untouched', () => {
    const r = checkReorder(
      [line({ quantity: 3, notes: 'no onions', allergens: ['nuts'] })],
      [item()],
    );
    expect(r.lines[0].quantity).toBe(3);
    expect(r.lines[0].notes).toBe('no onions');
    expect(r.lines[0].allergens).toEqual(['nuts']);
  });
});

describe('checkReorder — the failure this exists to prevent', () => {
  it('reprices a line to today’s price and reports the increase', () => {
    // Before this module the cart showed 100 and place_order charged 130 —
    // the customer only found out at the final tap.
    const r = checkReorder([line()], [item({ priceEgp: 130 })]);
    expect(r.lines[0].basePriceEgp).toBe(130);
    expect(r.changes).toEqual([
      { kind: 'price_up', itemId: 'i-1', name: 'Koshary', oldPriceEgp: 100, newPriceEgp: 130 },
    ]);
  });

  it('reports a price drop too, so the customer is told the good news', () => {
    const r = checkReorder([line()], [item({ priceEgp: 80 })]);
    expect(r.changes[0].kind).toBe('price_down');
    expect(r.lines[0].basePriceEgp).toBe(80);
  });

  it('drops an unavailable item rather than letting place_order reject it', () => {
    const r = checkReorder([line()], [item({ isAvailable: false })]);
    expect(r.lines).toHaveLength(0);
    expect(r.changes).toEqual([{ kind: 'unavailable', itemId: 'i-1', name: 'Koshary' }]);
    expect(r.allGone).toBe(true);
  });

  it('drops an item that is no longer on the menu at all', () => {
    const r = checkReorder([line()], []);
    expect(r.lines).toHaveLength(0);
    expect(r.changes[0].kind).toBe('removed');
    expect(r.allGone).toBe(true);
  });
});

describe('checkReorder — modifiers', () => {
  it('reprices from the LIVE option, not the saved delta', () => {
    const r = checkReorder([choseExtra(10)], [withExtra(25)]);
    expect(r.lines[0].modifierChoices[0].priceDeltaEgp).toBe(25);
    expect(r.changes).toEqual([
      { kind: 'price_up', itemId: 'i-1', name: 'Koshary', oldPriceEgp: 110, newPriceEgp: 125 },
    ]);
  });

  it('keeps the dish but drops a modifier option that no longer exists', () => {
    // Losing one add-on must not silently delete the whole dish.
    const r = checkReorder([choseExtra(10, 'o-gone')], [withExtra(10, 'o-1')]);
    expect(r.lines).toHaveLength(1);
    expect(r.lines[0].modifierChoices).toEqual([]);
    expect(r.changes.map((c) => c.kind)).toContain('modifier_gone');
  });

  it('reports the price change caused by a lost modifier', () => {
    const r = checkReorder([choseExtra(10, 'o-gone')], [withExtra(10, 'o-1')]);
    const priceChange = r.changes.find((c) => c.kind === 'price_down');
    expect(priceChange).toMatchObject({ oldPriceEgp: 110, newPriceEgp: 100 });
  });
});

describe('checkReorder — mixed and empty', () => {
  it('keeps the good lines and reports only the bad ones', () => {
    const past = [line(), line({ lineId: 'l-2', itemId: 'i-2', name: 'Molokhia' })];
    const menu = [item(), item({ id: 'i-2', name: 'Molokhia', isAvailable: false })];
    const r = checkReorder(past, menu);
    expect(r.lines.map((l) => l.itemId)).toEqual(['i-1']);
    expect(r.changes).toEqual([{ kind: 'unavailable', itemId: 'i-2', name: 'Molokhia' }]);
    expect(r.allGone).toBe(false);
  });

  it('is not "allGone" for an empty past order', () => {
    // No lines in, no lines out — but nothing was lost, so do not warn.
    expect(checkReorder([], []).allGone).toBe(false);
  });

  it('picks up a renamed dish so the cart never shows last month’s name', () => {
    const r = checkReorder([line()], [item({ name: 'Koshary Deluxe' })]);
    expect(r.lines[0].name).toBe('Koshary Deluxe');
  });

  it('does not mutate its inputs', () => {
    const past = [line()];
    const menu = [item({ priceEgp: 130 })];
    checkReorder(past, menu);
    expect(past[0].basePriceEgp).toBe(100);
    expect(menu[0].priceEgp).toBe(130);
  });
});
