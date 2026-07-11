/**
 * Service fee — display-side mirror of the server engine.
 *
 * The server is the source of truth: migration 096's `place_order` computes
 * `round(subtotal_egp * service_fee_pct / 100)` (no cap) on the food SUBTOTAL,
 * reading `platform_settings` key `service_fee_pct`.
 *
 * DARK ROLLOUT — this constant is shipped at 0 on purpose. `service_fee_pct` is
 * seeded 0 in prod (mig 096 ships dark), so place_order currently charges no
 * service fee. Keeping the mirror at 0 means the checkout preview shows no fee
 * and therefore always MATCHES what place_order charges (the N2 preview≠charge
 * lesson — an advertised total that differs from the charge is a trust/legal
 * problem). When the owner flips `service_fee_pct` to 3 server-side, ship a
 * one-line app update bumping SERVICE_FEE_PCT to 3 in the SAME release so the
 * preview stays equal to the charge at every point in the rollout.
 *
 * Note: the receipt reads the real per-order `order.serviceFeeEgp` from the DB,
 * so a past order's fee is always shown truthfully regardless of this constant.
 */
export const SERVICE_FEE_PCT = 0;

/**
 * The service fee for a given food subtotal: `round(subtotal * pct / 100)`,
 * matching place_order exactly (round-half-up to a whole EGP, no cap). Returns
 * 0 while SERVICE_FEE_PCT is 0 (the current dark state).
 */
export function serviceFeeEgp(subtotalEgp: number): number {
  return Math.round(subtotalEgp * (SERVICE_FEE_PCT / 100));
}
