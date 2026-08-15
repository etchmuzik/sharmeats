/**
 * One reconciliation path for every repeat-order entry point.
 *
 * There are three: the Orders-tab "Order again", the Home "Saved for you"
 * presets, and (later) a restored server cart. They must agree, or the same
 * basket reports different things depending on where the customer tapped.
 *
 * SERVER FIRST, CLIENT FALLBACK — BUT ONLY FOR TRANSPORT FAILURES.
 * `prepare_cart` (mig 145) is authoritative for what the menu says right now,
 * and it can answer questions the client cannot: is the store open, does the
 * basket clear the minimum order, has a modifier moved to another item. When it
 * is UNREACHABLE — offline, or an older backend without the RPC — this degrades
 * to the client-side `checkReorder`, which is better than blocking a reorder.
 *
 * A DENIAL IS NOT AN OUTAGE. VERTICAL_NOT_AVAILABLE (mig 153) is a decision,
 * not a failure: falling back on it would re-render a hidden merchant's catalog
 * from cached menu data and defeat the server gate entirely. It is re-thrown.
 *
 * The shape returned is the CLIENT one (`ReorderCheck`) so callers and their
 * copy are unchanged whichever path ran.
 */
import type { CartItem, MenuItem, PreparedCart, PreparedCartIssue } from '../data/types';
import { db, isBackendLive } from '../data';
import { checkReorder, type LineChange, type ReorderCheck } from './reorderCheck';

/**
 * The canonical server refusals that mean "you may not have this merchant".
 *
 * ONE CONTRACT, TWO NAMES, FOR A DELIBERATE REASON. Migration 153 introduced
 * VERTICAL_NOT_AVAILABLE; migration 162 then collapsed it into
 * MERCHANT_NOT_FOUND on the ordering paths, because a distinct error was an
 * existence oracle — guess UUIDs, and "hidden" vs "no such merchant" told you
 * which ones were real hidden merchants.
 *
 * That server fix broke this detector: it only knew the old name, so the new
 * denial fell through to the transport-failure branch and reopened the exact
 * leak the gate exists to prevent. Both names are therefore recognised — the
 * older one because migrations are applied in order and a device can talk to a
 * backend at either point, and MERCHANT_NOT_FOUND because it is now the answer
 * for a hidden merchant.
 *
 * Treating MERCHANT_NOT_FOUND as a denial is correct for the genuinely-missing
 * case too: a merchant that does not exist cannot be reordered from cache
 * either, so falling back would render a basket the server just refused.
 */
const DENIAL_CODES = ['VERTICAL_NOT_AVAILABLE', 'MERCHANT_NOT_FOUND'] as const;

/**
 * Is this a server REFUSAL rather than a transport failure?
 *
 * A denial must never degrade to the cached client path, or a hidden vertical
 * keeps rendering from whatever the device last fetched.
 */
export function isVerticalDenial(e: unknown): boolean {
  if (e == null) return false;
  if (typeof e === 'string') return DENIAL_CODES.some((c) => e.includes(c));
  // PostgREST surfaces a raised exception across several fields depending on
  // the client version and whether it was wrapped; check all of them rather
  // than betting on one shape.
  const err = e as { message?: unknown; code?: unknown; details?: unknown; hint?: unknown };
  const haystack = [err.message, err.code, err.details, err.hint]
    .filter((v): v is string => typeof v === 'string')
    .join(' ');
  return DENIAL_CODES.some((c) => haystack.includes(c));
}

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
    // REQUIRED_MODIFIER_MISSING used to be non-blocking here, because
    // place_order accepted it. Since migration 20260815044234 placement raises
    // MODIFIER_MIN_SELECTION for exactly this shape, so a silently adopted line
    // would fail at checkout with no indication of which item to fix.
    // Preparation must not be laxer than placement: report it with the change
    // vocabulary the UI already renders, and drop the line (see fromServer).
    case 'REQUIRED_MODIFIER_MISSING':
      return { kind: 'modifier_gone', ...base };
    // INVALID_QTY cannot come from a saved order — quantities are validated on
    // the way in.
    case 'INVALID_QTY':
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

  // A line whose required group has nothing selected is reported by the server
  // but still returned in `lines`. place_order rejects it (MODIFIER_MIN_SELECTION
  // since mig 20260815044234), so adopting it would build a cart that cannot
  // check out. Drop it here and let the reported change explain why.
  const unsatisfiedIndexes = new Set(
    prepared.issues
      .filter((issue) => issue.code === 'REQUIRED_MODIFIER_MISSING')
      .map((issue) => issue.index),
  );

  const lines: CartItem[] = prepared.lines
    .filter((l) => !unsatisfiedIndexes.has(l.index))
    .map((l) => {
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
    } catch (e) {
      // A DENIAL IS NOT AN OUTAGE. VERTICAL_NOT_AVAILABLE means the server has
      // decided this customer may not see this merchant at all; falling back to
      // the client path would re-render the hidden catalog from cached menu
      // data, which is exactly the leak the server gate exists to prevent.
      //
      // Only transport failures may degrade to the offline path.
      if (isVerticalDenial(e)) throw e;
      // Otherwise fall through: a reorder that reconciles slightly less
      // precisely beats an error dialog on the highest-intent tap in the app.
    }
  }
  return { ...checkReorder(past, menuForFallback), source: 'client' };
}
