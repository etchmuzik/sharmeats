import { getSupabase } from './supabase';

export interface RestaurantTierInfo {
  tier: 'bronze' | 'silver' | 'gold';
  ordersRolling90d: number;
  commissionPct: number;
  featured: boolean;
}

/** The current restaurant's loyalty tier + perks, or null if not resolved. */
export async function getMyRestaurantTier(): Promise<RestaurantTierInfo | null> {
  const { data, error } = await getSupabase().rpc('my_restaurant_tier');
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) return null;
  return {
    tier: row.tier,
    ordersRolling90d: row.orders_rolling_90d,
    commissionPct: row.commission_pct,
    featured: row.featured,
  };
}
