import type { PaymentMethod } from '../data/types';

/**
 * Card payments (Paymob) are gated behind a flag while the gateway isn't yet
 * live. Until Paymob is deployed + configured, the app ships CASH-ONLY: every
 * non-COD persisted method is hidden and rejected so it cannot be mistaken for
 * a cash order. This flag controls only the client experience: migration 221
 * also rejects every non-COD order at the database boundary. Do not enable
 * cards by changing this flag alone; a reviewed server-side card rollout is
 * required after the gateway intentions, webhook, and settlement flows exist.
 */
export const CARD_PAYMENTS_ENABLED = process.env.EXPO_PUBLIC_PAYMENTS_CARD_ENABLED === 'true';

// The payment edge function constructs this exact hosted Paymob checkout URL.
// Treat an edge-function response as network input anyway: opening a URL hands
// the customer to a different security boundary, so only the known HTTPS origin
// and checkout path are allowed through.
const PAYMOB_CHECKOUT_ORIGIN = 'https://accept.paymob.com';
const PAYMOB_CHECKOUT_PATH = '/unifiedcheckout/';

export function isTrustedPaymobCheckoutUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  try {
    const url = new URL(value);
    return (
      url.protocol === 'https:' &&
      url.origin === PAYMOB_CHECKOUT_ORIGIN &&
      url.pathname === PAYMOB_CHECKOUT_PATH &&
      url.searchParams.has('publicKey') &&
      url.searchParams.has('clientSecret') &&
      !url.hash
    );
  } catch {
    return false;
  }
}

/**
 * These are the only non-COD rails the app knows how to create an order for.
 * Fawry, Vodafone Cash and InstaPay must remain disabled even after card
 * payments launch: there is no server-side settlement flow for them yet.
 */
const IMPLEMENTED_CARD_KINDS: ReadonlySet<PaymentMethod['kind']> = new Set(['card', 'apple_pay']);

/** True when this persisted kind has a complete, supported checkout flow. */
export function isPaymentMethodKindEnabled(kind: PaymentMethod['kind']): boolean {
  return kind === 'cash' || (CARD_PAYMENTS_ENABLED && IMPLEMENTED_CARD_KINDS.has(kind));
}

/** True if this payment method should be offered to the customer right now. */
export function isPaymentMethodEnabled(pm: PaymentMethod): boolean {
  return isPaymentMethodKindEnabled(pm.kind);
}

/**
 * Convert a selected UI payment kind to the only values accepted by place_order.
 *
 * This is deliberately fail-closed. A stale saved wallet must never be silently
 * converted to cash-on-delivery, because that would tell the customer one thing
 * while placing a different order. The same guard also protects a stale client
 * that bypasses the payment picker.
 */
export function toOrderPaymentMethod(
  kind: PaymentMethod['kind'],
): 'card' | 'cash_on_delivery' {
  if (!isPaymentMethodKindEnabled(kind)) {
    throw new Error('This payment method is not available');
  }
  return kind === 'cash' ? 'cash_on_delivery' : 'card';
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

type TranslateFn = (key: string, vars?: Record<string, string | number>) => string;

/**
 * i18n keys for a payment method's display label + subline, by kind. The stored
 * label/subline (from payments.ts / the DB) are English fallbacks; the render
 * sites should prefer these localized strings so non-English users don't see raw
 * English. COD is the only launch method, so it's the one that matters most.
 */
const PAYMENT_LABEL_KEYS: Partial<Record<PaymentMethod['kind'], { label: string; subline?: string }>> = {
  cash: { label: 'payment.cash', subline: 'payment.cashSubline' },
  card: { label: 'payment.card' },
  apple_pay: { label: 'payment.applePay' },
  fawry: { label: 'payment.fawry' },
};

/**
 * Localized label/subline for a payment method. Falls back to the method's own
 * stored strings when no i18n key exists (or a key is missing → useT returns the
 * key, which we detect and ignore). Keeps a single source of truth for how a
 * payment method is presented across checkout + the picker.
 */
export function localizedPayment(
  t: TranslateFn,
  m: Pick<PaymentMethod, 'kind' | 'label' | 'subline'>,
): { label: string; subline: string } {
  const keys = PAYMENT_LABEL_KEYS[m.kind];
  const resolve = (key: string | undefined, fallback: string | undefined): string => {
    if (!key) return fallback ?? '';
    const out = t(key);
    // useT returns the key itself when a translation is missing — fall back then.
    return out === key ? fallback ?? '' : out;
  };
  return {
    label: resolve(keys?.label, m.label),
    subline: resolve(keys?.subline, m.subline),
  };
}
