/**
 * Delivery fee + order total math — CLIENT-SIDE MIRROR.
 *
 * The AUTHORITY for money is the Postgres `place_order` / `quote_delivery_fee`
 * RPCs. These functions exist only so the customer app can show an accurate
 * ESTIMATE before submitting. `place_order` always recomputes server-side and
 * the server value wins. Never trust a total computed here for anything that
 * settles money.
 *
 * All amounts are integer EGP piastres-free (whole EGP), matching the existing
 * schema where *_egp columns are `int`. Keep this in lockstep with
 * supabase/migrations/011_rpcs.sql.
 */

export interface CartLineForEstimate {
  basePriceEgp: number;
  quantity: number;
  modifierDeltaEgp: number; // sum of selected modifier price deltas for the line
}

/** Sum a line: (base + modifiers) * qty. */
export function lineTotalEgp(line: CartLineForEstimate): number {
  return (line.basePriceEgp + line.modifierDeltaEgp) * line.quantity;
}

/** Subtotal across all lines. */
export function subtotalEgp(lines: CartLineForEstimate[]): number {
  return lines.reduce((sum, l) => sum + lineTotalEgp(l), 0);
}

export interface DeliveryFeeInputs {
  /** Per-zone base fee from delivery_fee_rules. */
  baseFeeEgp: number;
  /** Distance-based component (0 for MVP — per_km_fee defaults to 0). */
  perKmFeeEgp?: number;
  distanceKm?: number;
  /** If subtotal >= freeOverEgp, delivery is free (null/undefined = never free). */
  freeOverEgp?: number | null;
  /** Floor for the computed fee. */
  minFeeEgp?: number;
}

/** Mirror of quote_delivery_fee. MVP: typically just baseFeeEgp. */
export function deliveryFeeEgp(subtotal: number, inputs: DeliveryFeeInputs): number {
  if (inputs.freeOverEgp != null && subtotal >= inputs.freeOverEgp) return 0;
  const distance = (inputs.perKmFeeEgp ?? 0) * (inputs.distanceKm ?? 0);
  const raw = inputs.baseFeeEgp + distance;
  return Math.max(raw, inputs.minFeeEgp ?? 0);
}

export interface OrderTotalInputs {
  subtotalEgp: number;
  deliveryFeeEgp: number;
  /** Tax in EGP (0 for MVP unless configured). */
  taxEgp?: number;
  tipEgp?: number;
  /** Promo discount in EGP (already validated server-side in real flow). */
  discountEgp?: number;
}

/** Mirror of the total computed in place_order. Clamped at 0. */
export function orderTotalEgp(i: OrderTotalInputs): number {
  const total =
    i.subtotalEgp +
    i.deliveryFeeEgp +
    (i.taxEgp ?? 0) +
    (i.tipEgp ?? 0) -
    (i.discountEgp ?? 0);
  return Math.max(0, total);
}

/** Default service fee percentage for MVP (0 — keep it simple to win merchants). */
export const DEFAULT_SERVICE_FEE_PCT = 0;

/** Default tax percentage for MVP (0 — prices are tax-inclusive at launch). */
export const DEFAULT_TAX_PCT = 0;
