import { getSupabase } from './client';
import { rowToMenuItem, rowToMenuSection } from './mappers';
import { restaurantsWithAllFlags, type FlaggedItemRow } from '../menuFlags';
import type { MenuItem, MenuSearchHit, MenuSection, Modifier } from '../types';

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

  /**
   * Cross-restaurant dish search in ONE round trip, via the search_menu_items
   * RPC (mig 169).
   *
   * This replaced a loop that called `forRestaurant` per restaurant — four round
   * trips each here, plus modifier hydration the results never render.
   *
   * The RPC rather than a `.or('name.ilike...,description.ilike...')` filter
   * because that filter is PostgREST SYNTAX built from user input: a comma or a
   * paren in the search box changes how it parses, and `%` / `_` silently widen
   * the match. The RPC binds the query as a parameter and escapes the LIKE
   * metacharacters server-side.
   *
   * It is SECURITY INVOKER, so RLS decides visibility exactly as it did before.
   */
  async search(query: string, limit = 12): Promise<MenuSearchHit[]> {
    const q = query.trim();
    // Mirrors the RPC's own floor; skipping the call entirely saves a round trip
    // on every one-character prefix while the user is still typing.
    if (q.length < 2) return [];

    const { data, error } = await getSupabase().rpc('search_menu_items', {
      p_query: q,
      p_limit: limit,
    });
    if (error) throw error;

    type Row = {
      item_id: string;
      item_name: string;
      item_image: string | null;
      price_egp: number;
      restaurant_id: string;
      restaurant_name: string;
    };
    return ((data ?? []) as Row[]).map((r) => ({
      itemId: r.item_id,
      itemName: r.item_name,
      itemImage: r.item_image ?? '',
      priceEgp: r.price_egp,
      restaurantId: r.restaurant_id,
      restaurantName: r.restaurant_name,
    }));
  },

  /**
   * Restaurant ids that can satisfy every one of `flags`, in ONE round trip.
   *
   * Also replaced a per-restaurant loop. `overlaps` narrows to items carrying at
   * least one requested flag, which is all the union check needs, and the
   * projection is two columns instead of whole item rows with modifier trees.
   */
  async restaurantsWithFlags(flags: readonly string[]): Promise<Set<string>> {
    if (flags.length === 0) return new Set();

    const { data, error } = await getSupabase()
      .from('menu_items')
      .select('restaurant_id, flags')
      .eq('is_available', true)
      .overlaps('flags', flags as string[]);
    if (error) throw error;

    const rows: FlaggedItemRow[] = ((data ?? []) as { restaurant_id: string; flags: string[] | null }[]).map(
      (r) => ({ restaurantId: r.restaurant_id, flags: r.flags ?? [] }),
    );
    return restaurantsWithAllFlags(rows, flags);
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
