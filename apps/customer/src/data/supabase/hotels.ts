import { getSupabase } from './client';
import { rowToHotel } from './mappers';
import type { Hotel } from '../types';

export const hotelsRepoSupabase = {
  async list(): Promise<Hotel[]> {
    const { data, error } = await getSupabase()
      .from('hotels')
      .select('*')
      .eq('verified', true)
      .order('name');
    if (error) throw error;
    return (data ?? []).map(rowToHotel);
  },

  async get(id: string): Promise<Hotel | null> {
    const { data, error } = await getSupabase()
      .from('hotels')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    if (error) throw error;
    return data ? rowToHotel(data) : null;
  },

  async search(query: string): Promise<Hotel[]> {
    if (!query) return this.list();
    const { data, error } = await getSupabase()
      .from('hotels')
      .select('*')
      .ilike('name', `%${query}%`)
      .order('name');
    if (error) throw error;
    return (data ?? []).map(rowToHotel);
  },
};
