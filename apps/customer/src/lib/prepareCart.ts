/**
 * One reconciliation path for every repeat-order entry point.
 *
 * There are three: the Orders-tab "Order again", the Home "Saved for you"
 * presets, and (later) a restored server cart. They must agree, or the same
 * basket reports different things depending on where the customer tapped.
 *
 * SERVER FIRST, CLIENT FALLBACK. `prepare_cart` (mig 145) is authoritative for
 * what the menu says right now, and it can answer questions the client cannot:
 * is the store open, does the basket clear the minimum order, has a modifier
 * moved to another item. When it is unreachable — offline, or an older backend
 * without the RPC — this degrades to the client-side `checkReorder`, which is
 * strictly better than blocking a reorder. `place_order` revalidates everything
 * at checkout either way, so the fallback risks a rejection at the final tap,
 * never a wrong charge.
 *
 * The shape returned is the CLIENT one (`ReorderCheck`) so callers and their
 * copy are unchanged whichever path ran.
 */
import type { CartItem, MenuItem, PreparedCart, PreparedCartIssue } from '../data/types';
import { db, isBackendLive } from '../data';
import { checkReorder, type LineChange, type ReorderCheck } from './reorderCheck';

export interface PreparedReorder extends ReorderCheck {
  /** Which path produced this — reported to analytics, never shown to the user. */
  source: 'server' | 'client';
  /** Store state. Undefined on the client path, which cannot determine it. */
  restaurantOpen?: boolean;
  minimumOrderEgp?: number;
  subtotalEgp?: number;
}

/** Server issue codes -> the client change vocabulary the UI already renders. */
function issueToChange(issue: PreparedCartIssue): LineChange | null {
  const base = { itemId: issue.itemId ?? '', name: issue.name ?? '' };
  switch (issue.code) {
    case 'ITEM_NOT_FOUND':
      return { kind: 'removed', ...base };
    case 'ITEM_UNAVAILABLE':
      return { kind: 'unavailable', ...base };
    case 'MODIFIER_GONE':
      return { kind: 'modifier_gone', ...base };
    // INVALID_QTY cannot come from a saved order (quantities are validated on
    // the way in), and REQUIRED_MODIFIER_MISSING is non-blocking server-side —
    // surfacing it as a scary "changed" dialog would misrepresent a cart that
    // place_order will happily accept.
    case 'INVALID_QTY':
    case 'REQUIRED_MODIFIER_MISSING':
      return null;
  }
}

/**
 * Map the server response onto the client shape, reporting price movement by
 * comparing each prepared line against what the past order paid.
 */
function fromServer(prepared: PreparedCart, past: CartItem[]): PreparedReorder {
  const pastById = new Map(past.map((p) => [p.itemId, p]));

  const changes: LineChange[] = prepared.issues
    .map(issueToChange)
    .filter((c): c is LineChange => c !== null);

  const lines: CartItem[] = prepared.lines.map((l) => {
    const before = pastById.get(l.itemId);
    const newUnit = l.unitPriceEgp + l.modifierChoices.reduce((a, c) => a + c.priceDeltaEgp, 0);

    if (before) {
      const oldUnit =
        before.basePriceEgp + before.modifierChoices.reduce((a, c) => a + c.priceDeltaEgp, 0);
      if (newUnit !== oldUnit) {
        changes.push({
          kind: newUnit > oldUnit ? 'price_up' : 'price_down',
          itemId: l.itemId,
          name: l.name,
          oldPriceEgp: oldUnit,
          newPriceEgp: newUnit,
        });
      }
    }

    return {
      // lineId is client-local; keep the original so cart edits stay stable.
      lineId: before?.lineId ?? `${l.itemId}-${l.index}`,
      itemId: l.itemId,
      restaurantId: prepared.restaurantId,
      name: l.name,
      basePriceEgp: l.unitPriceEgp,
      image: l.image ?? before?.image ?? '',
      quantity: l.quantity,
      modifierChoices: l.modifierChoices,
      notes: l.notes ?? undefined,
      // The customer's own allergen selection is not menu data, so the server
      // neither stores nor returns it. Carry it across untouched.
      allergens: before?.allergens,
    };
  });

  return {
    lines,
    changes,
    allGone: lines.length === 0 && past.length > 0,
    source: 'server',
    restaurantOpen: prepared.restaurantOpen,
    minimumOrderEgp: prepared.minimumOrderEgp,
    subtotalEgp: prepared.subtotalEgp,
  };
}

/**
 * Reconcile a past basket against the live menu.
 *
 * `menuForFallback` is used only when the server path is unavailable; pass the
 * menu the caller already fetched so the fallback costs no extra round trip.
 */
export async function prepareReorder(
  restaurantId: string,
  past: CartItem[],
  menuForFallback: MenuItem[],
): Promise<PreparedReorder> {
  if (isBackendLive) {
    try {
      const prepared = await db.orders.prepareCart(restaurantId, past);
      return fromServer(prepared, past);
    } catch {
      // Fall through. Deliberately silent: a reorder that works slightly less
      // precisely beats an error dialog on the highest-intent tap in the app.
    }
  }
  return { ...checkReorder(past, menuForFallback), source: 'client' };
}
