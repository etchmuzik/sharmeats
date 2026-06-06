import { getSupabase } from './client';
import { rowToMenuItem, rowToMenuSection } from './mappers';
import type { MenuItem, MenuSection, Modifier } from '../types';

/**
 * Load modifier groups + options for a set of menu items and attach them.
 *
 * The item modal needs each item's `modifiers` (with nested `options`) to render
 * choices, and place_order validates selected option ids against the item. The
 * base mapper returns modifiers: [] — we hydrate them here in two batched reads.
 */
async function attachModifiers(items: MenuItem[]): Promise<MenuItem[]> {
  if (items.length === 0) return items;
  const sb = getSupabase();
  const itemIds = items.map((i) => i.id);

  const { data: modRows, error: modErr } = await sb
    .from('modifiers')
    .select('*')
    .in('item_id', itemIds)
    .order('sort_order');
  if (modErr) throw modErr;

  const modifierIds = (modRows ?? []).map((m: { id: string }) => m.id);
  const { data: optRows, error: optErr } = modifierIds.length
    ? await sb
        .from('modifier_options')
        .select('*')
        .in('modifier_id', modifierIds)
        .order('sort_order')
    : { data: [], error: null };
  if (optErr) throw optErr;

  // Group options by modifier, modifiers by item.
  const optsByModifier = new Map<string, Modifier['options']>();
  for (const o of optRows ?? []) {
    const list = optsByModifier.get(o.modifier_id) ?? [];
    list.push({
      id: o.id,
      name: o.name,
      priceDeltaEgp: o.price_delta_egp,
      isDefault: o.is_default ?? undefined,
      // Presentation extras (mig 016) — drive add-on cards / popular badge.
      icon: o.icon ?? undefined,
      subtitle: o.subtitle ?? undefined,
      popular: o.popular ?? undefined,
      image: o.image ?? undefined,
      addsFlags: o.adds_flags ?? undefined,
    });
    optsByModifier.set(o.modifier_id, list);
  }

  const modsByItem = new Map<string, Modifier[]>();
  for (const m of modRows ?? []) {
    const list = modsByItem.get(m.item_id) ?? [];
    list.push({
      id: m.id,
      name: m.name,
      required: m.required,
      minSelect: m.min_select,
      maxSelect: m.max_select,
      options: optsByModifier.get(m.id) ?? [],
      // Presentation hint (mig 016) — picks the right UI (size/ingredients/addons).
      style: m.style ?? undefined,
      subtitle: m.subtitle ?? undefined,
      step: m.step ?? undefined,
    });
    modsByItem.set(m.item_id, list);
  }

  return items.map((it) => ({ ...it, modifiers: modsByItem.get(it.id) ?? [] }));
}

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

    const items = await attachModifiers((itemsRes.data ?? []).map(rowToMenuItem));
    return {
      sections: (sectionsRes.data ?? []).map(rowToMenuSection),
      items,
    };
  },

  async getItem(itemId: string): Promise<MenuItem | null> {
    const { data, error } = await getSupabase()
      .from('menu_items')
      .select('*')
      .eq('id', itemId)
      .maybeSingle();
    if (error) throw error;
    if (!data) return null;
    const [withMods] = await attachModifiers([rowToMenuItem(data)]);
    return withMods;
  },
};
