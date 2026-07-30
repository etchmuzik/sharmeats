import { describe, expect, it } from 'vitest';
import type { ItemFlag, MenuItem } from '../data/types';
import {
  escapeCatalogPattern,
  itemMatchesEveryFlag,
  orderCatalogItems,
} from './catalogSearch';

const item = (id: string, flags: ItemFlag[] = []): MenuItem => ({
  id,
  restaurantId: `restaurant-${id}`,
  sectionId: 'section',
  name: `Item ${id}`,
  description: '',
  priceEgp: 100,
  image: '',
  flags,
  isAvailable: true,
  modifiers: [],
});

describe('escapeCatalogPattern', () => {
  it('treats SQL and PostgREST wildcard characters as literal search text', () => {
    expect(escapeCatalogPattern(String.raw`50%_*off\today`)).toBe(
      String.raw`50\%\_\*off\\today`,
    );
  });
});

describe('orderCatalogItems', () => {
  it('restores ranked RPC order after the hydration query', () => {
    expect(orderCatalogItems(['b', 'a'], [item('a'), item('b')]).map((entry) => entry.id))
      .toEqual(['b', 'a']);
  });

  it('drops rows not requested by the visibility-scoped RPC', () => {
    expect(orderCatalogItems(['a'], [item('a'), item('hidden')]).map((entry) => entry.id))
      .toEqual(['a']);
  });
});

describe('itemMatchesEveryFlag', () => {
  it('requires one available dish to carry every selected dietary flag', () => {
    const dish = item('a', ['vegetarian', 'glutenfree']);

    expect(itemMatchesEveryFlag(dish, ['vegetarian', 'glutenfree'])).toBe(true);
    expect(itemMatchesEveryFlag(dish, ['vegetarian', 'spicy'])).toBe(false);
  });
});
