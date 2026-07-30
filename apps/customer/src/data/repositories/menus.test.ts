import { describe, it, expect } from 'vitest';
import { menusRepo } from './menus';
import { MENUS } from '../mock/menus';

/**
 * Derived from the fixture rather than hardcoded. An earlier draft searched for
 * "pizza", which no mock item is called — so every assertion ran against an empty
 * result set and proved nothing.
 */
const ALL_ITEMS = Object.values(MENUS).flatMap((menu) => menu.items);
/** A substring guaranteed to match at least one item name. */
const NEEDLE = ALL_ITEMS[0].name.slice(0, 4).toLowerCase();

/**
 * Contract tests for the mock adapter's search. The Supabase adapter answers the
 * same shape from the search_menu_items RPC (mig 185), whose own behaviour —
 * ordering, the two-character floor, LIKE-metacharacter escaping, limit clamping
 * — is asserted in supabase/tests/185_menu_search.test.sql. These pin the JS side
 * so the two adapters cannot drift apart silently.
 */
describe('menusRepo.search', () => {
  it('returns the six fields the results list renders, and nothing else', async () => {
    const hits = await menusRepo.search(NEEDLE);
    expect(hits.length).toBeGreaterThan(0);
    expect(Object.keys(hits[0]).sort()).toEqual([
      'itemId',
      'itemImage',
      'itemName',
      'priceEgp',
      'restaurantId',
      'restaurantName',
    ]);
  });

  it('attributes each hit to a named restaurant', async () => {
    for (const hit of await menusRepo.search(NEEDLE)) {
      expect(hit.restaurantId).toBeTruthy();
      expect(hit.restaurantName).toBeTruthy();
    }
  });

  // Mirrors the RPC's floor. Below it the adapter must not even look, because the
  // whole point is to stop work happening on every intermediate prefix.
  it('returns nothing below two characters', async () => {
    expect(await menusRepo.search('')).toEqual([]);
    expect(await menusRepo.search('p')).toEqual([]);
    expect(await menusRepo.search('  ')).toEqual([]);
    expect(await menusRepo.search(' p ')).toEqual([]);
  });

  it('is case-insensitive and ignores surrounding whitespace', async () => {
    const lower = await menusRepo.search(NEEDLE);
    const shouty = await menusRepo.search(`  ${NEEDLE.toUpperCase()}  `);
    expect(shouty.map((h) => h.itemId)).toEqual(lower.map((h) => h.itemId));
  });

  it('ranks name matches above description-only matches', async () => {
    // Find a term that appears in some item's DESCRIPTION but not its name, so
    // the two ranks are both represented and the ordering is actually exercised.
    const mixed = ALL_ITEMS.map((i) => i.description.split(/\s+/)[0]?.toLowerCase())
      .filter((w): w is string => !!w && w.length >= 3)
      .find((w) => {
        const inName = ALL_ITEMS.some((i) => i.name.toLowerCase().includes(w));
        const inDesc = ALL_ITEMS.some(
          (i) => i.description.toLowerCase().includes(w) && !i.name.toLowerCase().includes(w),
        );
        return inName && inDesc;
      });
    if (!mixed) return; // fixture has no such term; nothing to assert

    const hits = await menusRepo.search(mixed, 50);
    const ranks = hits.map((h) => (h.itemName.toLowerCase().includes(mixed) ? 0 : 1));
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
  });

  it('honours the limit and caps it at 50', async () => {
    expect((await menusRepo.search('a', 3)).length).toBe(0); // below the floor
    expect((await menusRepo.search(NEEDLE, 1)).length).toBeLessThanOrEqual(1);
    expect((await menusRepo.search(NEEDLE, 10_000)).length).toBeLessThanOrEqual(50);
  });

  it('returns a stable order for the same query', async () => {
    const a = await menusRepo.search(NEEDLE);
    const b = await menusRepo.search(NEEDLE);
    expect(a.map((h) => h.itemId)).toEqual(b.map((h) => h.itemId));
  });
});

describe('menusRepo.restaurantsWithFlags', () => {
  it('returns an empty set when no flags are requested', async () => {
    expect(await menusRepo.restaurantsWithFlags([])).toEqual(new Set());
  });

  it('returns a Set of restaurant ids for a known flag', async () => {
    const ids = await menusRepo.restaurantsWithFlags(['vegetarian']);
    expect(ids).toBeInstanceOf(Set);
    for (const id of ids) expect(typeof id).toBe('string');
  });

  it('narrows, never widens, as flags are added', async () => {
    const one = await menusRepo.restaurantsWithFlags(['vegetarian']);
    const two = await menusRepo.restaurantsWithFlags(['vegetarian', 'glutenfree']);
    expect(two.size).toBeLessThanOrEqual(one.size);
    for (const id of two) expect(one.has(id)).toBe(true);
  });

  it('returns nothing for a flag no item carries', async () => {
    expect(await menusRepo.restaurantsWithFlags(['definitely-not-a-flag'])).toEqual(new Set());
  });
});
