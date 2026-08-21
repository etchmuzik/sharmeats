import { getSupabase } from './client';
import type { Vertical, VerticalId } from '../types';

interface VerticalRow {
  id: string;
  name_en: string;
  name_ar: string;
  icon: string | null;
}

export const verticalsRepoSupabase = {
  /**
   * Verticals THIS account may enter. The verticals_public_read policy is the
   * whole gate: public launch_stage rows for everyone, private rows only for
   * holders of an active vertical_private_access grant. The client never
   * filters — a public user receives only `food` and renders no switcher.
   */
  async list(): Promise<Vertical[]> {
    const { data, error } = await getSupabase()
      .from('verticals')
      .select('id, name_en, name_ar, icon')
      .eq('is_active', true)
      .order('display_order')
      .order('id');
    if (error) throw error;
    return ((data ?? []) as VerticalRow[]).map((v) => ({
      id: v.id as VerticalId,
      nameEn: v.name_en,
      nameAr: v.name_ar,
      icon: v.icon ?? undefined,
    }));
  },
};
