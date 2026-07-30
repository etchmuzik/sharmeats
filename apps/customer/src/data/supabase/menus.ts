import { getSupabase } from './client';
import { rowToMenuItem, rowToMenuSection } from './mappers';
import type { ItemFlag, MenuItem, MenuSection, Modifier } from '../types';
import {
  escapeCatalogPattern,
  orderCatalogItems,
} from '../../lib/catalogSearch';

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
  async restaurantIdsForFlags(flags: ItemFlag[]): Promise<Set<string>> {
    if (flags.length === 0) return new Set();

    // Supabase projects cap a single Data API response (commonly at 1,000
    // rows). Page until exhaustion so a growing catalog never silently drops
    // restaurants beyond that boundary.
    const pageSize = 250;
    const restaurantIds = new Set<string>();
    let afterId: string | null = null;
    for (;;) {
      let query = getSupabase()
        .from('menu_items')
        .select('id,restaurant_id')
        .eq('is_available', true)
        .contains('flags', flags);
      if (afterId) query = query.gt('id', afterId);

      const { data, error } = await query.order('id').limit(pageSize);
      if (error) throw error;

      const page = (data ?? []) as { id: string; restaurant_id: string }[];
      if (page.length === 0) break;
      for (const row of page) restaurantIds.add(row.restaurant_id);
      afterId = page[page.length - 1].id;
    }

    return restaurantIds;
  },

  async search(query: string, limit = 12): Promise<MenuItem[]> {
    const normalized = query.trim();
    if (normalized.length < 2 || limit <= 0) return [];

    // Package 07 migration 188 owns visibility, availability and bounded
    // keyset search. Hydrate only the returned IDs so Browse gets images and
    // descriptions without downloading every restaurant menu.
    const { data: matches, error: searchError } = await getSupabase().rpc(
      'search_catalog',
      {
        p_query: escapeCatalogPattern(normalized),
        p_vertical: null,
        p_restaurant_id: null,
        p_limit: Math.min(limit, 100),
        p_after_name: null,
        p_after_id: null,
      },
    );
    if (searchError) throw searchError;

    const ids = ((matches ?? []) as { item_id: string }[]).map((row) => row.item_id);
    if (ids.length === 0) return [];

    const { data: items, error: hydrateError } = await getSupabase()
      .from('menu_items')
      .select('*')
      .in('id', ids);
    if (hydrateError) throw hydrateError;

    return orderCatalogItems(ids, (items ?? []).map(rowToMenuItem));
  },

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

    // Drop sections that have no available items. menu_items is filtered to
    // is_available=true above but menu_sections is not, so a section whose
    // items are all sold out would otherwise render as an orphan header (and a
    // dead nav tab). Filtering here keeps the section list and the items in
    // sync for both the menu body and the sticky section tabs.
    const sectionIdsWithItems = new Set(items.map((i) => i.sectionId));
    const sections = (sectionsRes.data ?? [])
      .map(rowToMenuSection)
      .filter((s) => sectionIdsWithItems.has(s.id));

    return { sections, items };
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
