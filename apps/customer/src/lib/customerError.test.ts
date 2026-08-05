import { describe, expect, it } from 'vitest';
import { customerErrorKey } from './customerError';

describe('customerErrorKey', () => {
  it('uses the correct safe fallback for each authentication action', () => {
    const backendError = new Error('Twilio rejected request: account SID secret=abc123');

    expect(customerErrorKey(backendError, 'sendOtp')).toBe('error.otpSendFailed');
    expect(customerErrorKey(backendError, 'verifyOtp')).toBe('error.otpInvalid');
    expect(customerErrorKey(backendError, 'resendOtp')).toBe('error.otpResendFailed');
  });

  it.each([
    ['EMPTY_CART', 'error.emptyCart'],
    ['MERCHANT_CLOSED', 'error.merchantClosed'],
    ['MERCHANT_NOT_FOUND', 'error.merchantNotFound'],
    ['CASH_NOT_ACCEPTED', 'error.cashNotAccepted'],
    ['CARD_NOT_ACCEPTED', 'error.cardNotAccepted'],
    ['ADDRESS_NOT_FOUND', 'error.addressNotFound'],
    ['ITEM_NOT_FOUND', 'error.itemNotFound'],
    ['ITEM_UNAVAILABLE', 'error.itemUnavailable'],
    ['BELOW_MIN_ORDER', 'error.belowMinOrder'],
    ['INVALID_QTY', 'error.invalidQty'],
    ['AUTH_REQUIRED', 'error.authRequired'],
    ['OUT_OF_RANGE', 'error.outOfRange'],
    ['USER_BLOCKED', 'error.userBlocked'],
    ['TOO_MANY_ACTIVE_ORDERS', 'error.tooManyActiveOrders'],
    ['NEW_USER_ORDER_LIMIT', 'error.newUserOrderLimit'],
  ] as const)('keeps a known checkout rejection actionable: %s', (code, expectedKey) => {
    expect(customerErrorKey(new Error(`RPC rejected request: ${code}`), 'placeOrder')).toBe(expectedKey);
  });

  it('recognizes an authentication rejection provided as an SDK status code', () => {
    expect(customerErrorKey({ status: 401 }, 'placeOrder')).toBe('error.authRequired');
  });

  it('uses a generic checkout message for unknown backend details', () => {
    const internalError = new Error('PGRST301: column customer_token exposed at line 4');

    const key = customerErrorKey(internalError, 'placeOrder');

    expect(key).toBe('error.placeOrderFailed');
    expect(key).not.toContain(internalError.message);
  });

  it('uses the generic recovery message for a route render failure', () => {
    expect(customerErrorKey({ message: 'TypeError: undefined is not an object' }, 'screen')).toBe(
      'common.error',
    );
  });
});
