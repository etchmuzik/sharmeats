import { describe, it, expect } from 'vitest';
import {
  MAX_RECENT_SEARCHES,
  MIN_RECENT_SEARCH_LENGTH,
  addRecentSearch,
  normalizeSearch,
  removeRecentSearch,
  sanitizeRecentSearches,
} from './recentSearches';

describe('normalizeSearch', () => {
  it('trims and collapses whitespace so one query is one entry', () => {
    expect(normalizeSearch('  pizza   margherita ')).toBe('pizza margherita');
    expect(normalizeSearch('pizza\t\nmargherita')).toBe('pizza margherita');
  });
});

describe('addRecentSearch', () => {
  it('puts the newest first', () => {
    expect(addRecentSearch(['pasta'], 'pizza')).toEqual(['pizza', 'pasta']);
  });

  it('does not remember a fragment too short to have searched', () => {
    const list = ['pizza'];
    expect(addRecentSearch(list, 'p')).toEqual(['pizza']);
    expect(addRecentSearch(list, ' ')).toEqual(['pizza']);
    expect(addRecentSearch(list, '')).toEqual(['pizza']);
    // Exactly at the threshold is remembered — the app searches at this length.
    expect(addRecentSearch(list, 'ab'.slice(0, MIN_RECENT_SEARCH_LENGTH))).toEqual(['ab', 'pizza']);
  });

  it('does not mutate the list it was given', () => {
    const list = ['pasta'];
    addRecentSearch(list, 'pizza');
    addRecentSearch(list, 'x');
    expect(list).toEqual(['pasta']);
  });

  /**
   * The whole point of a capped list: re-searching something must move it, not
   * add a second copy that crowds out seven other queries.
   */
  it('promotes a repeat instead of duplicating it', () => {
    const list = ['sushi', 'pasta', 'pizza'];
    expect(addRecentSearch(list, 'pizza')).toEqual(['pizza', 'sushi', 'pasta']);
  });

  it('treats casing and spacing differences as the same query, keeping what was just typed', () => {
    expect(addRecentSearch(['pizza'], 'Pizza')).toEqual(['Pizza']);
    expect(addRecentSearch(['sea bass'], '  SEA   BASS ')).toEqual(['SEA BASS']);
  });

  it('caps the list, dropping the oldest', () => {
    let list: string[] = [];
    for (let i = 0; i < MAX_RECENT_SEARCHES + 4; i += 1) list = addRecentSearch(list, `query${i}`);
    expect(list).toHaveLength(MAX_RECENT_SEARCHES);
    expect(list[0]).toBe(`query${MAX_RECENT_SEARCHES + 3}`);
    expect(list).not.toContain('query0');
  });
});

describe('removeRecentSearch', () => {
  it('removes the entry the user tapped, matched as it was deduped', () => {
    expect(removeRecentSearch(['pizza', 'pasta'], 'pizza')).toEqual(['pasta']);
    expect(removeRecentSearch(['Pizza', 'pasta'], 'pizza')).toEqual(['pasta']);
    expect(removeRecentSearch(['sea bass'], ' SEA  BASS ')).toEqual([]);
  });

  it('leaves the list alone when nothing matches', () => {
    expect(removeRecentSearch(['pizza'], 'sushi')).toEqual(['pizza']);
  });
});

/**
 * Persisted state is untrusted input — an older build's shape, a half-written
 * file, a restored backup. None of it may reach a tappable row unchecked.
 */
describe('sanitizeRecentSearches', () => {
  it('accepts a well-formed list unchanged', () => {
    expect(sanitizeRecentSearches(['pizza', 'pasta'])).toEqual(['pizza', 'pasta']);
  });

  it('returns empty for anything that is not an array', () => {
    expect(sanitizeRecentSearches(undefined)).toEqual([]);
    expect(sanitizeRecentSearches(null)).toEqual([]);
    expect(sanitizeRecentSearches('pizza')).toEqual([]);
    expect(sanitizeRecentSearches({ 0: 'pizza' })).toEqual([]);
  });

  it('drops non-strings rather than coercing them into a row that reads [object Object]', () => {
    const out = sanitizeRecentSearches(['pizza', { name: 'pasta' }, 42, null, ['sushi'], 'salad']);
    expect(out).toEqual(['pizza', 'salad']);
    expect(out.join(' ')).not.toContain('object');
  });

  it('drops entries too short to be real queries', () => {
    expect(sanitizeRecentSearches(['p', '', '   ', 'pizza'])).toEqual(['pizza']);
  });

  it('normalises and de-duplicates, keeping the first occurrence', () => {
    expect(sanitizeRecentSearches(['  pizza ', 'PIZZA', 'pasta'])).toEqual(['pizza', 'pasta']);
  });

  it('re-applies the cap, so a corrupted list cannot render thousands of rows', () => {
    const huge = Array.from({ length: 5000 }, (_, i) => `query${i}`);
    expect(sanitizeRecentSearches(huge)).toHaveLength(MAX_RECENT_SEARCHES);
  });
});
