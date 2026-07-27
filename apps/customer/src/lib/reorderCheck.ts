/**
 * Reorder revalidation.
 *
 * One-tap reorder loads a PAST order's lines straight into the cart, carrying
 * that order's prices and modifier deltas with them. Menus change: an item can
 * be repriced, sold out, or removed entirely between orders. Before this
 * module, the customer saw the old price all the way to checkout and only found
 * out at the final tap, because `place_order` recomputes every price from
 * `menu_items` and raises ITEM_UNAVAILABLE (verified against the deployed body).
 *
 * The money was never at risk — the server is authoritative and would never
 * have charged the stale price. What was at risk is the customer's trust on the
 * single highest-intent action in the app: a confident "Reorder" that ends in a
 * rejection reads as the app being broken.
 *
 * So this reconciles the saved lines against the CURRENT menu before the cart
 * is populated, and reports exactly what changed so the UI can say so plainly.
 * It deliberately does not decide policy — the caller chooses whether to drop
 * lines, ask, or proceed.
 */
import type { CartItem, MenuItem } from '../data/types';

export type LineChangeKind = 'removed' | 'unavailable' | 'price_up' | 'price_down' | 'modifier_gone';

export interface LineChange {
  kind: LineChangeKind;
  itemId: string;
  name: string;
  /** Price the past order paid, per unit including modifiers. */
  oldPriceEgp?: number;
  /** Price now, per unit including the still-valid modifiers. */
  newPriceEgp?: number;
}

export interface ReorderCheck {
  /** Lines that can go in the cart, repriced to today's menu. */
  lines: CartItem[];
  /** Everything that differs from the past order. Empty = clean reorder. */
  changes: LineChange[];
  /** True when nothing orderable survived — the caller should not open a cart. */
  allGone: boolean;
}

/** Per-unit price of a line: base + the sum of its modifier deltas. */
function unitPrice(basePriceEgp: number, deltas: number[]): number {
  return deltas.reduce((acc, d) => acc + d, basePriceEgp);
}

/**
 * Reconcile past-order lines against the current menu.
 *
 * Rules, in the order they are applied per line:
 *   - item no longer on the menu        -> dropped, reported 'removed'
 *   - item present but is_available=false -> dropped, reported 'unavailable'
 *   - a chosen modifier option is gone  -> line KEPT without that option and
 *                                          reported 'modifier_gone', because
 *                                          dropping a whole dish over one
 *                                          missing extra is worse than telling
 *                                          the customer the extra is gone
 *   - price differs                     -> line kept at TODAY's price, reported
 *                                          'price_up' or 'price_down'
 *
 * `quantity`, `notes` and `allergens` always carry over untouched: they are the
 * customer's own input, not menu data.
 */
export function checkReorder(pastLines: CartItem[], currentMenu: MenuItem[]): ReorderCheck {
  const byId = new Map(currentMenu.map((m) => [m.id, m]));
  const lines: CartItem[] = [];
  const changes: LineChange[] = [];

  for (const line of pastLines) {
    const current = byId.get(line.itemId);

    if (!current) {
      changes.push({ kind: 'removed', itemId: line.itemId, name: line.name });
      continue;
    }
    if (!current.isAvailable) {
      changes.push({ kind: 'unavailable', itemId: line.itemId, name: current.name });
      continue;
    }

    // Keep only modifier choices that still exist on the current item, and
    // reprice each from the live option rather than trusting the saved delta.
    const liveOptions = new Map(
      current.modifiers.flatMap((m) => m.options.map((o) => [o.id, { option: o, modifier: m }])),
    );
    const keptChoices: CartItem['modifierChoices'] = [];
    let lostModifier = false;
    for (const choice of line.modifierChoices) {
      const live = liveOptions.get(choice.optionId);
      if (!live) {
        lostModifier = true;
        continue;
      }
      keptChoices.push({
        modifierId: live.modifier.id,
        modifierName: live.modifier.name,
        optionId: live.option.id,
        optionName: live.option.name,
        priceDeltaEgp: live.option.priceDeltaEgp,
      });
    }
    if (lostModifier) {
      changes.push({ kind: 'modifier_gone', itemId: line.itemId, name: current.name });
    }

    const oldUnit = unitPrice(
      line.basePriceEgp,
      line.modifierChoices.map((c) => c.priceDeltaEgp),
    );
    const newUnit = unitPrice(
      current.priceEgp,
      keptChoices.map((c) => c.priceDeltaEgp),
    );
    if (newUnit !== oldUnit) {
      changes.push({
        kind: newUnit > oldUnit ? 'price_up' : 'price_down',
        itemId: line.itemId,
        name: current.name,
        oldPriceEgp: oldUnit,
        newPriceEgp: newUnit,
      });
    }

    lines.push({
      ...line,
      // Refresh the display fields from the live item too, so a renamed dish or
      // a new photo does not show the customer last month's version.
      name: current.name,
      image: current.image,
      basePriceEgp: current.priceEgp,
      modifierChoices: keptChoices,
    });
  }

  return { lines, changes, allGone: lines.length === 0 && pastLines.length > 0 };
}

/**
 * Human-readable summary of the changes, given a translator and money
 * formatter. Kept here (rather than in a screen) because both the Orders tab
 * "Order again" and the Home "Saved for you" presets need the identical
 * wording — two copies would drift.
 */
export function describeReorderChanges(
  changes: LineChange[],
  t: (key: string, vars?: Record<string, string | number>) => string,
  formatMoney: (egp: number) => string,
): string {
  return changes
    .map((c) => {
      switch (c.kind) {
        case 'price_up':
        case 'price_down':
          return t('orders.reorderPriceChanged', {
            name: c.name,
            price: formatMoney(c.newPriceEgp ?? 0),
          });
        case 'unavailable':
          return t('orders.reorderUnavailable', { name: c.name });
        case 'removed':
          return t('orders.reorderRemoved', { name: c.name });
        case 'modifier_gone':
          return t('orders.reorderModifierGone', { name: c.name });
      }
    })
    .join('\n');
}
