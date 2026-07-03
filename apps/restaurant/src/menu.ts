import { getSupabase } from './supabase';

/**
 * Menu availability ("86-ing") for the kitchen tablet.
 *
 * `menu_items.is_available` is enforced by the place_order RPC (an unavailable
 * item is rejected with ITEM_UNAVAILABLE), so toggling it here instantly stops
 * new orders for a sold-out dish. RLS policy `menu_items_merchant_write`
 * (migration 012) lets a restaurant staffer update their own items.
 */

export interface MenuItem {
  id: string;
  restaurant_id: string;
  section_id: string;
  name: string;
  price_egp: number;
  is_available: boolean;
  sort_order: number;
}

const MENU_ITEM_SELECT = 'id, restaurant_id, section_id, name, price_egp, is_available, sort_order';

/** All menu items for a restaurant (available and 86'd), ordered for display. */
export async function getMenuItems(restaurantId: string): Promise<MenuItem[]> {
  const { data, error } = await getSupabase()
    .from('menu_items')
    .select(MENU_ITEM_SELECT)
    .eq('restaurant_id', restaurantId)
    .order('sort_order', { ascending: true })
    .order('name', { ascending: true });
  if (error) throw error;
  return (data ?? []) as unknown as MenuItem[];
}

/** Mark an item in- or out-of-stock ("86" it). RLS scopes this to own items. */
export async function setItemAvailability(itemId: string, available: boolean): Promise<void> {
  const { error } = await getSupabase()
    .from('menu_items')
    .update({ is_available: available })
    .eq('id', itemId);
  if (error) throw error;
}
