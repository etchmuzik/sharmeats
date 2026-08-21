import { getSupabase } from './client';
import { rowToRestaurant, type RestaurantRow } from './mappers';
import type { Cuisine, Restaurant, Review } from '../types';

/**
 * Exactly the columns rowToRestaurant reads — nothing wider.
 *
 * These four queries used `select('*')`, which made the storefront ask for every
 * column on the table: merchant banking identity (payout_iban / payout_wallet /
 * payout_holder / payout_bank_name / payout_method), the negotiated
 * commission_pct, place_id and the terms-acceptance record. RLS could never have
 * prevented that — restaurants_read (mig 153) is meant to expose every active
 * merchant, so "which rows" is correctly "all of them"; "which columns" is an
 * ACL question, and `*` asked for all of those too.
 *
 * Migration 218 revokes those columns from anon and authenticated. `*` expands
 * to every column in the table, so it fails outright once a single column is
 * ungranted — which is why this list ships FIRST and the migration second. This
 * list works under both the old and new ACL.
 *
 * `vertical_id` is included even though RestaurantRow does not declare it: the
 * mapper reads it through a cast, with a 'food' fallback for older backends.
 */
export const RESTAURANT_COLUMNS =
  'id, slug, name, description, cuisines, cuisine_label, cover_image, logo, zone, ' +
  'rating, rating_count, prep_time_low, prep_time_high, delivery_fee_egp, min_order_egp, ' +
  'distance_meters, tourist_safe, is_open, is_open_24h, promo, featured, phone, address, ' +
  'website, merchant_type, vertical_id';

export const restaurantsRepoSupabase = {
  async list(filter?: { cuisine?: Cuisine; query?: string }): Promise<Restaurant[]> {
    let q = getSupabase().from('restaurants').select(RESTAURANT_COLUMNS).eq('is_active', true);
    if (filter?.cuisine) q = q.contains('cuisines', [filter.cuisine]);
    if (filter?.query) q = q.ilike('name', `%${filter.query}%`);
    const { data, error } = await q.order('rating', { ascending: false });
    if (error) throw error;
    // Food-only until the vertical discovery UI ships: a pilot-allowlisted
    // account otherwise sees grocery/pharmacy merchants rendered as
    // malformed restaurant cards. Server launch_stage still gates everyone else.
    return ((data ?? []) as unknown as RestaurantRow[])
      .map(rowToRestaurant)
      .filter((r) => r.verticalId === 'food');
  },

  async listFeatured(): Promise<Restaurant[]> {
    const { data, error } = await getSupabase()
      .from('restaurants')
      .select(RESTAURANT_COLUMNS)
      .eq('is_active', true)
      .eq('featured', true);
    if (error) throw error;
    // Food-only until the vertical discovery UI ships: a pilot-allowlisted
    // account otherwise sees grocery/pharmacy merchants rendered as
    // malformed restaurant cards. Server launch_stage still gates everyone else.
    return ((data ?? []) as unknown as RestaurantRow[])
      .map(rowToRestaurant)
      .filter((r) => r.verticalId === 'food');
  },

  async get(id: string): Promise<Restaurant | null> {
    const { data, error } = await getSupabase()
      .from('restaurants')
      .select(RESTAURANT_COLUMNS)
      .eq('id', id)
      .maybeSingle();
    if (error) throw error;
    return data ? rowToRestaurant(data as unknown as RestaurantRow) : null;
  },

  async getBySlug(slug: string): Promise<Restaurant | null> {
    const { data, error } = await getSupabase()
      .from('restaurants')
      .select(RESTAURANT_COLUMNS)
      .eq('slug', slug)
      .maybeSingle();
    if (error) throw error;
    return data ? rowToRestaurant(data as unknown as RestaurantRow) : null;
  },

  /**
   * Anonymized public reviews via the get_restaurant_reviews RPC (SECURITY
   * DEFINER — exposes only masked reviewer + ratings, never order details).
   */
  async reviews(restaurantId: string, limit = 20): Promise<Review[]> {
    const { data, error } = await getSupabase().rpc('get_restaurant_reviews', {
      p_restaurant_id: restaurantId,
      p_limit: limit,
    });
    if (error) throw error;
    type Row = {
      rating_food: number;
      rating_delivery: number;
      comment: string | null;
      reviewer: string;
      reviewed_at: string;
    };
    return ((data ?? []) as Row[]).map((r) => ({
      ratingFood: r.rating_food,
      ratingDelivery: r.rating_delivery,
      comment: r.comment ?? undefined,
      reviewer: r.reviewer,
      reviewedAt: new Date(r.reviewed_at).getTime(),
    }));
  },
};
