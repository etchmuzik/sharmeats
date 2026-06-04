import { MENUS } from '../mock/menus';
import type { MenuItem, MenuSection } from '../types';

const delay = <T>(value: T, ms = 60): Promise<T> =>
  new Promise((resolve) => setTimeout(() => resolve(value), ms));

export const menusRepo = {
  async forRestaurant(restaurantId: string): Promise<{ sections: MenuSection[]; items: MenuItem[] }> {
    const m = MENUS[restaurantId];
    if (!m) return delay({ sections: [], items: [] });
    return delay(m);
  },

  async getItem(itemId: string): Promise<MenuItem | null> {
    for (const m of Object.values(MENUS)) {
      const found = m.items.find((i) => i.id === itemId);
      if (found) return delay(found);
    }
    return delay(null);
  },
};
