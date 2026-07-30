/**
 * Scheduled ordering is a release-gated capability, not only a checkout control.
 *
 * The current backend stores `scheduled_for`, but it does not yet enforce
 * restaurant operating hours or hold acceptance, kitchen progression and
 * dispatch until the correct preparation window. Showing arbitrary time chips
 * before those controls exist can create an order that moves immediately while
 * the customer expects it later.
 *
 * Fail closed. Enable only after the complete scheduled-order lifecycle has
 * production evidence.
 */
export function scheduledOrdersEnabled(): boolean {
  return process.env.EXPO_PUBLIC_SCHEDULED_ORDERS_ENABLED === 'true';
}
