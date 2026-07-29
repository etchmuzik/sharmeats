import { MENUS } from '../mock/menus';
import { RESTAURANTS } from '../mock/restaurants';
import { restaurantsWithAllFlags, type FlaggedItemRow } from '../menuFlags';
import type { MenuItem, MenuSearchHit, MenuSection } from '../types';

const delay = <T>(value: T, ms = 60): Promise<T> =>
  new Promise((resolve) => setTimeout(() => resolve(value), ms));

/** Mirrors the RPC's ordering so switching adapters does not reshuffle results. */
function rankOf(item: MenuItem, needle: string): number {
  return item.name.toLowerCase().includes(needle) ? 0 : 1;
}

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

  /**
   * Same contract as the Supabase adapter's `search`: name matches before
   * description-only matches, then alphabetical, capped at `limit`.
   *
   * Iterating the whole fixture is fine here — it is an in-memory object with no
   * round trips, which is precisely why the N+1 was invisible in mock mode and
   * only expensive against the real backend.
   */
  async search(query: string, limit = 12): Promise<MenuSearchHit[]> {
    const needle = query.trim().toLowerCase();
    if (needle.length < 2) return delay([]);

    const nameById = new Map(RESTAURANTS.map((r) => [r.id, r.name]));
    const hits: { hit: MenuSearchHit; rank: number }[] = [];

    for (const [restaurantId, menu] of Object.entries(MENUS)) {
      for (const item of menu.items) {
        if (item.isAvailable === false) continue;
        const matches =
          item.name.toLowerCase().includes(needle) ||
          item.description.toLowerCase().includes(needle);
        if (!matches) continue;
        hits.push({
          rank: rankOf(item, needle),
          hit: {
            itemId: item.id,
            itemName: item.name,
            itemImage: item.image,
            priceEgp: item.priceEgp,
            restaurantId,
            restaurantName: nameById.get(restaurantId) ?? '',
          },
        });
      }
    }

    hits.sort((a, b) => a.rank - b.rank || a.hit.itemName.localeCompare(b.hit.itemName));
    return delay(hits.slice(0, Math.max(1, Math.min(limit, 50))).map((h) => h.hit));
  },

  async restaurantsWithFlags(flags: readonly string[]): Promise<Set<string>> {
    if (flags.length === 0) return delay(new Set<string>());
    const rows: FlaggedItemRow[] = [];
    for (const [restaurantId, menu] of Object.entries(MENUS)) {
      for (const item of menu.items) {
        if (item.isAvailable === false) continue;
        rows.push({ restaurantId, flags: item.flags });
      }
    }
    return delay(restaurantsWithAllFlags(rows, flags));
  },
};
