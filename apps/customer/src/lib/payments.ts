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
