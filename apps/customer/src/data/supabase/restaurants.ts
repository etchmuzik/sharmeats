import { getSupabase } from './client';
import { rowToRestaurant } from './mappers';
import type { Cuisine, Restaurant, Review } from '../types';

export const restaurantsRepoSupabase = {
  async list(filter?: { cuisine?: Cuisine; query?: string }): Promise<Restaurant[]> {
    let q = getSupabase().from('restaurants').select('*').eq('is_active', true);
    if (filter?.cuisine) q = q.contains('cuisines', [filter.cuisine]);
    if (filter?.query) q = q.ilike('name', `%${filter.query}%`);
    const { data, error } = await q.order('rating', { ascending: false });
    if (error) throw error;
    return (data ?? []).map(rowToRestaurant);
  },

  async listFeatured(): Promise<Restaurant[]> {
    const { data, error } = await getSupabase()
      .from('restaurants')
      .select('*')
      .eq('is_active', true)
      .eq('featured', true);
    if (error) throw error;
    return (data ?? []).map(rowToRestaurant);
  },

  async get(id: string): Promise<Restaurant | null> {
    const { data, error } = await getSupabase()
      .from('restaurants')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    if (error) throw error;
    return data ? rowToRestaurant(data) : null;
  },

  async getBySlug(slug: string): Promise<Restaurant | null> {
    const { data, error } = await getSupabase()
      .from('restaurants')
      .select('*')
      .eq('slug', slug)
      .maybeSingle();
    if (error) throw error;
    return data ? rowToRestaurant(data) : null;
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
