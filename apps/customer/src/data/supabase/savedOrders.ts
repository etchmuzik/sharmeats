import { getSupabase } from './client';
import { SAVED_ORDERS_CAP, SavedOrdersCapError } from '../repositories/savedOrders';
import type { SaveSavedOrderInput } from '../repositories/savedOrders';
import type { CartItem, SavedOrder } from '../types';

interface SavedOrderRow {
  id: string;
  restaurant_id: string;
  name: string;
  items: CartItem[];
  created_at: string;
}

function rowToSavedOrder(row: SavedOrderRow, restaurantName: string): SavedOrder {
  return {
    id: row.id,
    restaurantId: row.restaurant_id,
    restaurantName,
    name: row.name,
    items: row.items,
    createdAt: row.created_at,
  };
}

export const savedOrdersRepoSupabase = {
  /** Owner-scoped by RLS. Newest first. Restaurant name is denormalized from the join. */
  async list(): Promise<SavedOrder[]> {
    const { data, error } = await getSupabase()
      .from('saved_orders')
      .select('id, restaurant_id, name, items, created_at, restaurants(name)')
      .order('created_at', { ascending: false });
    if (error) throw error;
    // The untyped Supabase client (no generated Database types in this project)
    // infers embedded to-one relations as an array shape; at runtime PostgREST
    // returns a single related row (or null) for this restaurant_id FK.
    type RowWithRestaurant = SavedOrderRow & { restaurants: { name: string }[] | { name: string } | null };
    return (data ?? []).map((r: RowWithRestaurant) => {
      const restaurant = Array.isArray(r.restaurants) ? r.restaurants[0] : r.restaurants;
      return rowToSavedOrder(r, restaurant?.name ?? '');
    });
  },

  async save(input: SaveSavedOrderInput): Promise<SavedOrder> {
    const sb = getSupabase();
    const { data: { user } } = await sb.auth.getUser();
    if (!user) throw new Error('Not authenticated');

    // App-side cap. A concurrent double-save could momentarily exceed 5; that is
    // acceptable (no correctness/security impact) and the UI gates the common case.
    const { count, error: countErr } = await sb
      .from('saved_orders')
      .select('id', { count: 'exact', head: true });
    if (countErr) throw countErr;
    if ((count ?? 0) >= SAVED_ORDERS_CAP) throw new SavedOrdersCapError();

    const { data, error } = await sb
      .from('saved_orders')
      .insert({
        user_id: user.id,
        restaurant_id: input.restaurantId,
        name: input.name,
        items: input.items,
      })
      .select('id, restaurant_id, name, items, created_at')
      .single();
    if (error) throw error;
    return rowToSavedOrder(data as SavedOrderRow, input.restaurantName);
  },

  async remove(id: string): Promise<void> {
    const { error } = await getSupabase().from('saved_orders').delete().eq('id', id);
    if (error) throw error;
  },
};
