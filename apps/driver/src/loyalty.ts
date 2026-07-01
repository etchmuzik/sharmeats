import { getSupabase } from './supabase';

export interface DriverTierInfo {
  tier: 'bronze' | 'silver' | 'gold';
  deliveriesRolling90d: number;
  bonusPerDeliveryEgp: number;
  firstLookSeconds: number;
  acceptanceRateSnapshot: number;
  ratingSnapshot: number;
}

/** The current driver's loyalty tier + perks, or null if not yet computed. */
export async function getMyTier(): Promise<DriverTierInfo | null> {
  const { data, error } = await getSupabase().rpc('my_driver_tier');
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) return null;
  return {
    tier: row.tier,
    deliveriesRolling90d: row.deliveries_rolling_90d,
    bonusPerDeliveryEgp: row.bonus_per_delivery_egp,
    firstLookSeconds: row.first_look_seconds,
    acceptanceRateSnapshot: row.acceptance_rate_snapshot,
    ratingSnapshot: row.rating_snapshot,
  };
}
