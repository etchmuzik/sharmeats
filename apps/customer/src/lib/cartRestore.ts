/**
 * Resolving a server cart into the local basket (Package 02 Slice D).
 *
 * This is the step between "the server has a cart" and "the customer is looking
 * at it". It exists as its own module, separate from the sheet that renders the
 * choice, because the rule it enforces is a data rule rather than a UI one:
 *
 *   A SERVER CART IS NEVER LOADED STRAIGHT INTO THE BASKET.
 *
 * The stored row holds identity only — item ids, quantities, modifier option
 * ids, notes — and no prices, because mig 168 has no column for them. So the
 * only way to turn it into something displayable is to ask prepare_cart (mig
 * 145) for today's prices, availability and store state. Loading the JSON
 * directly would show a basket with no prices at all, or tempt someone to
 * "helpfully" cache prices in the row, which is the self-service-discount hole
 * that migration deliberately closes.
 *
 * prepare_cart also answers the questions the row cannot: is the restaurant
 * open, does the basket still clear the minimum, has an item been withdrawn
 * since the cart was saved. A cart saved a week ago is exactly the case where
 * those answers have changed.
 */
import type { CartItem, MenuItem, ServerCart } from '../data/types';
import { db } from '../data';
import { prepareReorder, isVerticalDenial } from './prepareCart';

export interface RestoredCart {
  restaurantId: string;
  restaurantName: string;
  /** Reconciled at TODAY's prices, ready for the local store. */
  lines: CartItem[];
  /** How many lines the server cart had that did not survive reconciliation. */
  droppedCount: number;
  /** Whether anything changed (price, availability, modifiers) vs the saved row. */
  changed: boolean;
  /** Store state, so the caller can block checkout on a closed restaurant. */
  restaurantOpen?: boolean;
  minimumOrderEgp?: number;
}

/**
 * The server row's identity lines are not `CartItem`s — they have no name, price
 * or image. prepare_cart supplies all three, but it takes a CartItem-shaped
 * input, so this builds the minimal stand-in it needs.
 *
 * The placeholder price is 0, never a guess. prepareReorder compares the
 * prepared price against this to report "price changed", so a fabricated
 * previous price would invent a change that never happened. 0 means the caller
 * treats every line as new rather than as moved — which is honest, because a
 * saved cart genuinely does not know what it used to cost.
 */
function toCartItemStubs(cart: ServerCart): CartItem[] {
  return cart.lines.map((l, i) => ({
    lineId: `srv-${i}`,
    itemId: l.itemId,
    restaurantId: cart.restaurantId ?? '',
    name: '',
    basePriceEgp: 0,
    image: '',
    quantity: l.quantity,
    // prepare_cart is told the chosen option ids; it returns their current names
    // and price deltas, which is where the real modifier data comes from.
    modifierChoices: l.modifierOptionIds.map((optionId) => ({
      modifierId: '',
      modifierName: '',
      optionId,
      optionName: '',
      priceDeltaEgp: 0,
    })),
    notes: l.notes,
  }));
}

/**
 * Turn a stored server cart into a basket at current prices.
 *
 * Throws when the cart cannot be restored at all — a vertical denial, or a
 * transport failure with no usable menu. The caller reports
 * `cart_restore_failed` and leaves the local basket untouched; a failed restore
 * must never empty a cart the customer can currently see.
 */
export async function restoreServerCart(cart: ServerCart): Promise<RestoredCart> {
  if (!cart.restaurantId || cart.lines.length === 0) {
    throw new Error('CART_EMPTY');
  }

  // The restaurant lookup and the menu are both needed: the name for the sheet
  // and the confirmation, the menu as prepareReorder's offline fallback.
  const [restaurant, menu] = await Promise.all([
    db.restaurants.get(cart.restaurantId),
    db.menus.forRestaurant(cart.restaurantId),
  ]);

  // A merchant that has vanished (or been hidden from this customer) is not
  // restorable. Re-throwing rather than rendering from cached menu data is the
  // same rule prepareCart.ts follows for vertical denials.
  if (!restaurant) throw new Error('MERCHANT_NOT_FOUND');

  const stubs = toCartItemStubs(cart);

  // prepareReorder is the shared path every repeat-order entry point uses, so a
  // restored cart reconciles identically to an Order Again tap. It re-throws
  // vertical denials and degrades to the client check only on transport failure.
  const prepared = await prepareReorder(cart.restaurantId, stubs, menu.items);

  return {
    restaurantId: cart.restaurantId,
    restaurantName: restaurant.name,
    lines: prepared.lines,
    droppedCount: Math.max(0, stubs.length - prepared.lines.length),
    // Only availability/modifier changes count as "changed" here. Price movement
    // is excluded deliberately: the stub price is 0, so every line would look
    // like a price change and the customer would be warned about nothing.
    changed: prepared.changes.some(
      (c) => c.kind === 'removed' || c.kind === 'unavailable' || c.kind === 'modifier_gone',
    ),
    restaurantOpen: prepared.restaurantOpen,
    minimumOrderEgp: prepared.minimumOrderEgp,
  };
}

/** Re-exported so callers handle a denial without importing two modules. */
export { isVerticalDenial };

/** Bounded analytics reason for a failed restore — never the error text. */
export function restoreFailureReason(e: unknown): string {
  if (isVerticalDenial(e)) return 'denied';
  const msg = e instanceof Error ? e.message : String(e ?? '');
  if (msg.includes('CART_EMPTY')) return 'empty';
  if (msg.includes('MERCHANT_NOT_FOUND')) return 'merchant_gone';
  return 'unavailable';
}
