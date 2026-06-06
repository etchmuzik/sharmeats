import type { PaymentMethod } from '../data/types';

/**
 * Card payments (Paymob) are gated behind a flag while the gateway isn't yet
 * live. Until Paymob is deployed + configured, the app ships CASH-ONLY: card and
 * Apple Pay are hidden everywhere so no customer can pick a payment path that
 * can't complete. Flip EXPO_PUBLIC_PAYMENTS_CARD_ENABLED=true (and rebuild)
 * once the paymob-create-intention / paymob-webhook functions + secrets are set.
 */
export const CARD_PAYMENTS_ENABLED = process.env.EXPO_PUBLIC_PAYMENTS_CARD_ENABLED === 'true';

const GATED_KINDS: ReadonlySet<PaymentMethod['kind']> = new Set(['card', 'apple_pay']);

/** True if this payment method should be offered to the customer right now. */
export function isPaymentMethodEnabled(pm: PaymentMethod): boolean {
  if (CARD_PAYMENTS_ENABLED) return true;
  return !GATED_KINDS.has(pm.kind);
}

/**
 * Cash on delivery is a universal option, not a stored instrument — it needs no
 * saved card/row. A guest (or any user with no saved methods) must still be able
 * to pay, so we always offer COD at checkout regardless of what's in the DB.
 */
export const CASH_ON_DELIVERY_METHOD: PaymentMethod = {
  id: 'cod-default',
  kind: 'cash',
  label: 'Cash on delivery',
  subline: 'Pay the driver when your order arrives',
  isDefault: true,
};

/**
 * Ensure a Cash-on-Delivery option is always present. Prepends the universal COD
 * method unless the list already contains a `cash` method (e.g. a seeded row).
 */
export function withCashOnDelivery(methods: readonly PaymentMethod[]): PaymentMethod[] {
  if (methods.some((m) => m.kind === 'cash')) return [...methods];
  return [CASH_ON_DELIVERY_METHOD, ...methods];
}
