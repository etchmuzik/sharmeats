import { describe, it, expect } from 'vitest';
import { restaurantsWithAllFlags, type FlaggedItemRow } from './menuFlags';

const rows: FlaggedItemRow[] = [
  // r1 covers both flags, but across TWO different items.
  { restaurantId: 'r1', flags: ['vegetarian'] },
  { restaurantId: 'r1', flags: ['glutenfree'] },
  // r2 has one item carrying both.
  { restaurantId: 'r2', flags: ['vegetarian', 'glutenfree'] },
  // r3 only ever has one of them.
  { restaurantId: 'r3', flags: ['vegetarian'] },
  { restaurantId: 'r3', flags: ['vegetarian'] },
  // r4 carries neither of the flags we filter on.
  { restaurantId: 'r4', flags: ['halal'] },
];

describe('restaurantsWithAllFlags', () => {
  it('matches a single flag', () => {
    expect(restaurantsWithAllFlags(rows, ['vegetarian'])).toEqual(new Set(['r1', 'r2', 'r3']));
  });

  /**
   * The per-RESTAURANT union is the semantic this preserves from the code it
   * replaced: a place with a vegetarian dish and a separate gluten-free dish can
   * serve someone filtering for both. Requiring one item to carry every flag
   * would quietly shrink the result set.
   */
  it('unions flags across a restaurant rather than requiring one item to hold all', () => {
    expect(restaurantsWithAllFlags(rows, ['vegetarian', 'glutenfree'])).toEqual(
      new Set(['r1', 'r2']),
    );
  });

  it('excludes a restaurant missing any required flag', () => {
    const result = restaurantsWithAllFlags(rows, ['vegetarian', 'glutenfree']);
    expect(result.has('r3')).toBe(false);
    expect(result.has('r4')).toBe(false);
  });

  it('is order-independent for the required list', () => {
    expect(restaurantsWithAllFlags(rows, ['glutenfree', 'vegetarian'])).toEqual(
      restaurantsWithAllFlags(rows, ['vegetarian', 'glutenfree']),
    );
  });

  /**
   * Empty required list returns EMPTY, not everything. Callers treat "no filter"
   * separately; returning every id would be indistinguishable from "all match" at
   * the call site and one refactor away from a silent filter bypass.
   */
  it('returns an empty set when nothing is required', () => {
    expect(restaurantsWithAllFlags(rows, [])).toEqual(new Set());
  });

  it('handles no rows and unknown flags', () => {
    expect(restaurantsWithAllFlags([], ['vegetarian'])).toEqual(new Set());
    expect(restaurantsWithAllFlags(rows, ['nonexistent'])).toEqual(new Set());
  });

  it('ignores a flag a restaurant has that was not asked about', () => {
    // r4's 'halal' must not make it qualify for a vegetarian filter.
    expect(restaurantsWithAllFlags(rows, ['halal'])).toEqual(new Set(['r4']));
    expect(restaurantsWithAllFlags(rows, ['halal', 'vegetarian'])).toEqual(new Set());
  });

  it('tolerates an item with no flags', () => {
    const withEmpty: FlaggedItemRow[] = [
      { restaurantId: 'r5', flags: [] },
      { restaurantId: 'r5', flags: ['vegetarian'] },
    ];
    expect(restaurantsWithAllFlags(withEmpty, ['vegetarian'])).toEqual(new Set(['r5']));
  });
});
