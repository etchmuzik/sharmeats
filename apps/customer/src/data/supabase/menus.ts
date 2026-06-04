import { getSupabase } from './client';
import { rowToMenuItem, rowToMenuSection } from './mappers';
import type { MenuItem, MenuSection } from '../types';

export const menusRepoSupabase = {
  async forRestaurant(
    restaurantId: string,
  ): Promise<{ sections: MenuSection[]; items: MenuItem[] }> {
    const sb = getSupabase();
    const [sectionsRes, itemsRes] = await Promise.all([
      sb.from('menu_sections').select('*').eq('restaurant_id', restaurantId).order('sort_order'),
      sb
        .from('menu_items')
        .select('*')
        .eq('restaurant_id', restaurantId)
        .eq('is_available', true)
        .order('sort_order'),
    ]);
    if (sectionsRes.error) throw sectionsRes.error;
    if (itemsRes.error) throw itemsRes.error;
    return {
      sections: (sectionsRes.data ?? []).map(rowToMenuSection),
      items: (itemsRes.data ?? []).map(rowToMenuItem),
    };
  },

  async getItem(itemId: string): Promise<MenuItem | null> {
    const { data, error } = await getSupabase()
      .from('menu_items')
      .select('*')
      .eq('id', itemId)
      .maybeSingle();
    if (error) throw error;
    return data ? rowToMenuItem(data) : null;
  },
};
