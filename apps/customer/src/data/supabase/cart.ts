/**
 * Live server-cart adapter (migs 168/169).
 *
 * READ is a plain table SELECT, not an RPC: customer_carts grants SELECT and RLS
 * scopes it to the caller, so a restore costs one cheap round trip with no
 * function call. WRITES go through the RPCs because the client holds no write
 * grant at all — see mig 169's header for why (the client must not be able to
 * choose its own `version`).
 */
import { getSupabase } from './client';
import type { ServerCart, ServerCartLine, ServerCartWrite } from '../types';

/** Raw row shape from customer_carts. */
interface CartRow {
  restaurant_id: string | null;
  items: unknown;
  kitchen_notes: string | null;
  version: number | string;
  updated_at: string;
  expires_at: string;
}

/**
 * The server stores snake_case identity lines. Parse defensively: this is the one
 * place a malformed or partially-migrated row could reach the cart store, and a
 * throw here would strand the customer on a blank cart with no way to recover.
 * Unparseable lines are dropped, not guessed at — a dropped line reappears as a
 * "removed" issue from prepare_cart, which is an outcome the UI already explains.
 */
function parseLines(raw: unknown): ServerCartLine[] {
  if (!Array.isArray(raw)) return [];
  const out: ServerCartLine[] = [];
  for (const entry of raw) {
    if (typeof entry !== 'object' || entry === null) continue;
    const e = entry as Record<string, unknown>;
    const itemId = typeof e.item_id === 'string' ? e.item_id : null;
    const quantity = typeof e.quantity === 'number' ? e.quantity : Number(e.quantity);
    if (!itemId || !Number.isFinite(quantity) || quantity < 1) continue;
    const ids = Array.isArray(e.modifier_option_ids)
      ? e.modifier_option_ids.filter((v): v is string => typeof v === 'string')
      : [];
    out.push({
      itemId,
      quantity: Math.floor(quantity),
      modifierOptionIds: ids,
      // `?? undefined` so a SQL NULL does not become the literal string "null"
      // if this ever reaches a template.
      notes: typeof e.notes === 'string' && e.notes.length > 0 ? e.notes : undefined,
    });
  }
  return out;
}

/**
 * Does this error mean "another device wrote first"?
 *
 * PostgREST surfaces a raised exception across several fields depending on
 * client version and wrapping, so check all of them rather than betting on one
 * shape (same approach as isVerticalDenial in lib/prepareCart.ts).
 */
function isVersionConflict(e: unknown): boolean {
  if (e == null) return false;
  if (typeof e === 'string') return e.includes('CART_VERSION_CONFLICT');
  const err = e as { message?: unknown; code?: unknown; details?: unknown; hint?: unknown };
  return [err.message, err.code, err.details, err.hint]
    .filter((v): v is string => typeof v === 'string')
    .join(' ')
    .includes('CART_VERSION_CONFLICT');
}

export const cartRepoSupabase = {
  async get(): Promise<ServerCart | null> {
    // maybeSingle(): "no cart yet" is the normal first-run state, not an error.
    const { data, error } = await getSupabase()
      .from('customer_carts')
      .select('restaurant_id, items, kitchen_notes, version, updated_at, expires_at')
      .maybeSingle();
    if (error) throw error;
    if (!data) return null;
    const row = data as CartRow;
    return {
      restaurantId: row.restaurant_id,
      lines: parseLines(row.items),
      kitchenNotes: row.kitchen_notes ?? undefined,
      // version is bigint; PostgREST may deliver it as a string. Number() is safe
      // here — a cart would need ~9e15 edits to lose precision.
      version: Number(row.version),
      updatedAt: row.updated_at,
      expiresAt: row.expires_at,
    };
  },

  async upsert(input: {
    restaurantId: string | null;
    lines: ServerCartLine[];
    kitchenNotes?: string;
    expectedVersion: number;
  }): Promise<ServerCartWrite> {
    try {
      const { data, error } = await getSupabase().rpc('upsert_my_cart', {
        p_restaurant_id: input.restaurantId,
        p_items: input.lines.map((l) => ({
          item_id: l.itemId,
          quantity: l.quantity,
          modifier_option_ids: l.modifierOptionIds,
          notes: l.notes ?? null,
        })),
        p_kitchen_notes: input.kitchenNotes ?? null,
        p_expected_version: input.expectedVersion,
      });
      if (error) throw error;
      // RETURNS TABLE, so PostgREST delivers an array of one row.
      const row = (Array.isArray(data) ? data[0] : data) as
        | { version: number | string; updated_at: string; expires_at: string }
        | undefined;
      if (!row) throw new Error('upsert_my_cart returned no row');
      return {
        ok: true,
        version: Number(row.version),
        updatedAt: row.updated_at,
        expiresAt: row.expires_at,
      };
    } catch (e) {
      // A conflict is an expected outcome with a UI response, not a failure to
      // report. Everything else propagates.
      if (isVersionConflict(e)) return { ok: false, conflict: true };
      throw e;
    }
  },

  async clear(): Promise<void> {
    const { error } = await getSupabase().rpc('clear_my_cart');
    if (error) throw error;
  },
};
