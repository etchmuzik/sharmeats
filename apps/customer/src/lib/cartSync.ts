/**
 * Server-cart synchronisation (Package 02 Slice D).
 *
 * The local cart in `store/cart.ts` stays the source of truth for what the
 * customer is looking at right now. This module mirrors it to the server so the
 * basket survives a reinstall and appears on a second device, and resolves the
 * collision when two devices disagree.
 *
 * ================= WHAT IS SENT, AND WHAT IS NOT =================
 * Only identity: item id, quantity, chosen modifier option ids, notes. Prices
 * are deliberately never sent — the server has no column for them (mig 168) and
 * a restore recomputes them through `prepare_cart`. Allergen selections are also
 * not sent: they are the customer's own annotation, not menu data, and the
 * server neither stores nor returns them (same reasoning as lib/prepareCart.ts,
 * which carries them across untouched).
 *
 * ================= WHY DEBOUNCE =================
 * A cart mutates on every +/- tap. Writing each one would burn round trips and,
 * worse, make version conflicts likely between a device's own in-flight writes.
 * Mutations therefore coalesce into one write per quiet period.
 *
 * ================= THE CONFLICT RULE =================
 * On CART_VERSION_CONFLICT the app ALWAYS asks the customer which cart to keep,
 * even when both carts are from the same restaurant. Auto-taking the newer cart
 * would silently discard whatever the other device added, and a silent
 * discard in a basket is indistinguishable from a bug. One extra tap in a rare
 * case is the cheaper failure.
 */
import type { CartItem, ServerCart, ServerCartLine } from '../data/types';

/** Local cart lines -> the identity-only shape the server stores. */
export function toServerLines(lines: CartItem[]): ServerCartLine[] {
  return lines.map((l) => ({
    itemId: l.itemId,
    quantity: l.quantity,
    modifierOptionIds: l.modifierChoices.map((c) => c.optionId),
    notes: l.notes,
  }));
}

/**
 * Is the local cart already what the server holds?
 *
 * Used to skip no-op writes (a hydrate that changed nothing, a screen focus).
 * Compares identity only, because that is all the server stores — a local price
 * refresh is not a reason to write.
 *
 * Order matters: two carts with the same lines in a different order are treated
 * as different, because the customer sees them in that order and the server
 * preserves it.
 */
export function sameAsServer(local: CartItem[], server: ServerCartLine[]): boolean {
  if (local.length !== server.length) return false;
  return local.every((l, i) => {
    const s = server[i];
    if (!s) return false;
    if (l.itemId !== s.itemId || l.quantity !== s.quantity) return false;
    if ((l.notes ?? undefined) !== (s.notes ?? undefined)) return false;
    const a = l.modifierChoices.map((c) => c.optionId);
    const b = s.modifierOptionIds;
    if (a.length !== b.length) return false;
    // Modifier order within a line is not customer-visible, so compare as sets.
    const sortedA = [...a].sort();
    const sortedB = [...b].sort();
    return sortedA.every((v, j) => v === sortedB[j]);
  });
}

/** Has this stored cart passed its TTL horizon? */
export function isStale(cart: Pick<ServerCart, 'expiresAt'>, now = Date.now()): boolean {
  const t = Date.parse(cart.expiresAt);
  // An unparseable date must not silently mean "fresh"; treat it as stale so the
  // customer is asked rather than handed a basket of unknown age.
  if (!Number.isFinite(t)) return true;
  return t < now;
}

/**
 * What should happen when the app finds a server cart at startup?
 *
 * Pure decision function so the (many) cases are testable without a store, a
 * network or a React tree.
 */
export type RestoreDecision =
  /** Nothing on the server, or it is empty. Keep the local cart as-is. */
  | { kind: 'keep_local' }
  /** Local cart is empty and the server has one: adopt it (still via prepare_cart). */
  | { kind: 'adopt_server'; cart: ServerCart; stale: boolean }
  /**
   * Both sides have a cart and they differ. ALWAYS ask — including when the
   * restaurant matches. See the conflict rule above.
   */
  | { kind: 'ask'; cart: ServerCart; stale: boolean; sameRestaurant: boolean }
  /** Both sides hold the same basket; nothing to do but record the version. */
  | { kind: 'in_sync'; cart: ServerCart };

export function decideRestore(
  local: { restaurantId: string | null; lines: CartItem[] },
  server: ServerCart | null,
  now = Date.now(),
): RestoreDecision {
  if (!server || server.lines.length === 0) return { kind: 'keep_local' };

  const stale = isStale(server, now);

  if (local.lines.length === 0) return { kind: 'adopt_server', cart: server, stale };

  if (sameAsServer(local.lines, server.lines) && local.restaurantId === server.restaurantId) {
    return { kind: 'in_sync', cart: server };
  }

  return {
    kind: 'ask',
    cart: server,
    stale,
    // Reported so the sheet can word itself precisely ("a newer cart from this
    // restaurant" vs "a cart from another restaurant"), NOT so it can skip the
    // prompt — the rule is to always ask.
    sameRestaurant: local.restaurantId === server.restaurantId,
  };
}
