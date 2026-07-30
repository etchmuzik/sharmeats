import { describe, expect, it } from 'vitest';
import { menusRepo } from './menus';
import { restaurantsRepo } from './restaurants';

describe('mock catalog visibility mirrors the public Package 07 stage', () => {
  it('does not expose private grocery or pharmacy restaurants', async () => {
    const restaurants = await restaurantsRepo.list();

    expect(restaurants.every((restaurant) => restaurant.verticalId === 'food')).toBe(true);
    expect(await restaurantsRepo.get('r-carrefour-naama')).toBeNull();
    expect(await restaurantsRepo.get('r-ezaby-pharmacy')).toBeNull();
  });

  it('does not return private pilot dishes through search or dietary filters', async () => {
    expect(await menusRepo.search('لبن', 12)).toEqual([]);

    const vegetarianRestaurants = await menusRepo.restaurantIdsForFlags(['vegetarian']);
    expect(vegetarianRestaurants.has('r-carrefour-naama')).toBe(false);
  });

  it('returns an empty menu for a private restaurant deep link', async () => {
    expect(await menusRepo.forRestaurant('r-carrefour-naama')).toEqual({
      sections: [],
      items: [],
    });
  });

  it('returns null for a private item deep link', async () => {
    expect(await menusRepo.getItem('i-cn-milk')).toBeNull();
  });

  it('returns no reviews for a private restaurant', async () => {
    expect(await restaurantsRepo.reviews('r-carrefour-naama')).toEqual([]);
  });

  it('matches the live adapter contract for an empty flag selection', async () => {
    expect(await menusRepo.restaurantIdsForFlags([])).toEqual(new Set());
  });
});
