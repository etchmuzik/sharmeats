import { MENUS } from '../mock/menus';
import { PUBLIC_RESTAURANTS } from '../mock/restaurants';
import type { ItemFlag, MenuItem, MenuSection } from '../types';
import { itemMatchesEveryFlag } from '../../lib/catalogSearch';

const delay = <T>(value: T, ms = 60): Promise<T> =>
  new Promise((resolve) => setTimeout(() => resolve(value), ms));
const publicRestaurantIds = new Set(PUBLIC_RESTAURANTS.map((restaurant) => restaurant.id));

export const menusRepo = {
  async restaurantIdsForFlags(flags: ItemFlag[]): Promise<Set<string>> {
    if (flags.length === 0) return delay(new Set());

    const restaurantIds = new Set(
      Object.values(MENUS)
        .flatMap((menu) => menu.items)
        .filter(
          (item) =>
            publicRestaurantIds.has(item.restaurantId) &&
            itemMatchesEveryFlag(item, flags),
        )
        .map((item) => item.restaurantId),
    );
    return delay(restaurantIds);
  },

  async search(query: string, limit = 12): Promise<MenuItem[]> {
    const normalized = query.trim().toLowerCase();
    if (normalized.length < 2 || limit <= 0) return delay([]);

    const matches = Object.values(MENUS)
      .flatMap((menu) => menu.items)
      .filter(
        (item) =>
          publicRestaurantIds.has(item.restaurantId) &&
          item.isAvailable &&
          item.name.toLowerCase().includes(normalized),
      )
      .slice(0, limit);
    return delay(matches);
  },

  async forRestaurant(restaurantId: string): Promise<{ sections: MenuSection[]; items: MenuItem[] }> {
    if (!publicRestaurantIds.has(restaurantId)) {
      return delay({ sections: [], items: [] });
    }

    const m = MENUS[restaurantId];
    if (!m) return delay({ sections: [], items: [] });
    return delay(m);
  },

  async getItem(itemId: string): Promise<MenuItem | null> {
    for (const [restaurantId, m] of Object.entries(MENUS)) {
      if (!publicRestaurantIds.has(restaurantId)) continue;
      const found = m.items.find((i) => i.id === itemId);
      if (found) return delay(found);
    }
    return delay(null);
  },
};
