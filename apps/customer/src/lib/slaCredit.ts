/**
 * Late-delivery (SLA) credit — display-side mirror of the server engine.
 *
 * The server is the source of truth: migration 062's `snapshot_order_financials`
 * trigger credits `least(sla_credit_max_egp, floor(subtotal_egp * sla_credit_pct / 100))`
 * when an order lands 15+ min past its promise, reading `platform_settings` keys
 * `sla_credit_pct` (seeded 10) and `sla_credit_max_egp` (seeded 100).
 *
 * These constants mirror those seeded defaults so the app never promises more
 * than the engine pays (Egypt CPL 181/2018 — advertised compensation must be
 * honored). If the settings change server-side, update these to match.
 */
export const SLA_CREDIT_PCT = 10;
export const SLA_CREDIT_MAX_EGP = 100;

/**
 * The credit the customer actually receives if their order is late:
 * 10% of the food SUBTOTAL (not the total — delivery fee/tip excluded),
 * floored to a whole EGP, capped at 100 EGP.
 */
export function slaCreditEgp(subtotalEgp: number): number {
  return Math.min(SLA_CREDIT_MAX_EGP, Math.floor(subtotalEgp * (SLA_CREDIT_PCT / 100)));
}
