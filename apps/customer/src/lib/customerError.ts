/**
 * Translation keys that are safe to show after an operation fails. Keeping
 * this as a pure mapper prevents server, SDK, or native error details from
 * reaching customer-facing UI while callers can still send the original error
 * to telemetry.
 */
export type CustomerErrorContext = 'sendOtp' | 'verifyOtp' | 'resendOtp' | 'placeOrder' | 'screen';

export type CustomerErrorKey =
  | 'common.error'
  | 'error.addressNotFound'
  | 'error.authRequired'
  | 'error.belowMinOrder'
  | 'error.cardNotAccepted'
  | 'error.cashNotAccepted'
  | 'error.emptyCart'
  | 'error.invalidQty'
  | 'error.itemNotFound'
  | 'error.itemUnavailable'
  | 'error.merchantClosed'
  | 'error.merchantNotFound'
  | 'error.newUserOrderLimit'
  | 'error.otpInvalid'
  | 'error.otpResendFailed'
  | 'error.modifierInvalid'
  | 'error.modifierSelection'
  | 'error.otpSendFailed'
  | 'error.outOfRange'
  | 'error.placeOrderFailed'
  | 'error.tooManyActiveOrders'
  | 'error.userBlocked';

const checkoutErrorKeys: Record<string, CustomerErrorKey> = {
  EMPTY_CART: 'error.emptyCart',
  MERCHANT_CLOSED: 'error.merchantClosed',
  MERCHANT_NOT_FOUND: 'error.merchantNotFound',
  CASH_NOT_ACCEPTED: 'error.cashNotAccepted',
  CARD_NOT_ACCEPTED: 'error.cardNotAccepted',
  ADDRESS_NOT_FOUND: 'error.addressNotFound',
  ITEM_NOT_FOUND: 'error.itemNotFound',
  ITEM_UNAVAILABLE: 'error.itemUnavailable',
  BELOW_MIN_ORDER: 'error.belowMinOrder',
  INVALID_QTY: 'error.invalidQty',
  AUTH_REQUIRED: 'error.authRequired',
  OUT_OF_RANGE: 'error.outOfRange',
  USER_BLOCKED: 'error.userBlocked',
  TOO_MANY_ACTIVE_ORDERS: 'error.tooManyActiveOrders',
  NEW_USER_ORDER_LIMIT: 'error.newUserOrderLimit',
  // place_order enforces modifier ownership and min/max selection since
  // migration 20260815044234. Before it, a stale option id was silently
  // dropped from the snapshot, so these never reached the client.
  INVALID_MODIFIER_OPTION: 'error.modifierInvalid',
  DUPLICATE_MODIFIER_OPTION: 'error.modifierInvalid',
  MODIFIER_MIN_SELECTION: 'error.modifierSelection',
  MODIFIER_MAX_SELECTION: 'error.modifierSelection',
};

function errorFields(error: unknown): string[] {
  if (typeof error === 'string') return [error];
  if (!error || typeof error !== 'object') return [];

  try {
    const candidate = error as { code?: unknown; message?: unknown; status?: unknown };
    return [candidate.code, candidate.message, candidate.status]
      .filter((value): value is string | number => typeof value === 'string' || typeof value === 'number')
      .map(String);
  } catch {
    return [];
  }
}

function checkoutErrorKey(error: unknown): CustomerErrorKey {
  const fields = errorFields(error);
  if (fields.includes('401')) return 'error.authRequired';

  for (const [code, key] of Object.entries(checkoutErrorKeys)) {
    const codePattern = new RegExp(`(?:^|[^A-Z0-9_])${code}(?:$|[^A-Z0-9_])`);
    if (fields.some((field) => codePattern.test(field.toUpperCase()))) return key;
  }

  return 'error.placeOrderFailed';
}

/**
 * Maps an unknown operational failure to a shipped localization key. This
 * function intentionally never returns error.message or any other untrusted
 * input: technical detail belongs in captureError, not in the interface.
 */
export function customerErrorKey(
  error: unknown,
  context: CustomerErrorContext,
): CustomerErrorKey {
  switch (context) {
    case 'sendOtp':
      return 'error.otpSendFailed';
    case 'verifyOtp':
      return 'error.otpInvalid';
    case 'resendOtp':
      return 'error.otpResendFailed';
    case 'placeOrder':
      return checkoutErrorKey(error);
    case 'screen':
      return 'common.error';
  }
}
