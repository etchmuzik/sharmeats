/**
 * The cross-sell rail must never offer a prescription-only item.
 *
 * The rail is ONE TAP: `addSuggestion` writes straight into the cart with
 * `modifierChoices: []` and no detail screen in between. That is the whole
 * point of the rail, and it is also why an Rx item cannot appear in it — the
 * RxBadge lives on the item card and the item detail sheet, neither of which
 * the rail renders. A prescription item here would be added silently, and the
 * customer would first hear about the requirement from the driver, at the
 * door, after paying.
 */
import { describe, expect, it } from 'vitest';
import type { MenuItem } from '../data/types';
import { isCrossSellEligible } from './crossSell';

const item = (over: Partial<MenuItem> = {}): MenuItem =>
  ({
    id: 'i1',
    name: 'Sunscreen SPF 50',
    priceEgp: 120,
    isAvailable: true,
    modifiers: [],
    ...over,
  }) as MenuItem;

describe('isCrossSellEligible', () => {
  it('excludes a prescription-only item', () => {
    expect(isCrossSellEligible(item({ requiresPrescription: true }))).toBe(false);
  });

  it('allows an ordinary item', () => {
    expect(isCrossSellEligible(item())).toBe(true);
  });

  // The mapper leaves `requiresPrescription` undefined when the column is null
  // or false (see data/supabase/catalogFields.test.ts). Food items — the bulk
  // of the catalog — therefore arrive with the field absent, not `false`. A
  // strict `=== false` check here would empty the rail for every restaurant.
  it('allows an item whose flag is absent or explicitly false', () => {
    expect(isCrossSellEligible(item({ requiresPrescription: undefined }))).toBe(true);
    expect(isCrossSellEligible(item({ requiresPrescription: false }))).toBe(true);
  });

  it('still excludes unavailable items and items needing a required modifier', () => {
    expect(isCrossSellEligible(item({ isAvailable: false }))).toBe(false);
    expect(
      isCrossSellEligible(
        item({
          modifiers: [
            { id: 'm1', name: 'Size', required: true, minSelect: 1, maxSelect: 1, options: [] },
          ],
        }),
      ),
    ).toBe(false);
  });

  // Rx wins over every other signal: an available, modifier-free, cheap Rx item
  // is exactly the shape the rail would otherwise rank FIRST.
  it('excludes a prescription item that is otherwise perfectly eligible', () => {
    expect(
      isCrossSellEligible(
        item({ priceEgp: 15, isAvailable: true, modifiers: [], requiresPrescription: true }),
      ),
    ).toBe(false);
  });
});
