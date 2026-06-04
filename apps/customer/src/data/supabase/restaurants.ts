import { getSupabase } from './client';
import { rowToRestaurant } from './mappers';
import type { Cuisine, Restaurant } from '../types';

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
};
