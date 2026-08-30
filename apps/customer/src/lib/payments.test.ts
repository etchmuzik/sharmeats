import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PaymentMethod, PaymentMethodKind } from '../data/types';
import { isTrustedPaymobCheckoutUrl } from './payments';

function paymentMethod(kind: PaymentMethodKind): PaymentMethod {
  return {
    id: `pm-${kind}`,
    kind,
    label: kind,
    subline: '',
  };
}

async function loadPaymentPolicy(cardPaymentsEnabled: boolean) {
  vi.resetModules();
  vi.stubEnv('EXPO_PUBLIC_PAYMENTS_CARD_ENABLED', String(cardPaymentsEnabled));
  return import('./payments');
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('isTrustedPaymobCheckoutUrl', () => {
  const valid =
    'https://accept.paymob.com/unifiedcheckout/?publicKey=pk_test&clientSecret=checkout-secret';

  it('accepts the exact HTTPS checkout contract emitted by the payment function', () => {
    expect(isTrustedPaymobCheckoutUrl(valid)).toBe(true);
  });

  it.each([
    'http://accept.paymob.com/unifiedcheckout/?publicKey=pk_test&clientSecret=checkout-secret',
    'https://accept.paymob.com.evil.example/unifiedcheckout/?publicKey=pk_test&clientSecret=checkout-secret',
    'https://accept.paymob.com/account/login?publicKey=pk_test&clientSecret=checkout-secret',
    'https://accept.paymob.com/unifiedcheckout/?publicKey=pk_test',
    'https://accept.paymob.com/unifiedcheckout/?clientSecret=checkout-secret',
    'javascript:alert(1)',
    '',
  ])('rejects an untrusted or incomplete checkout URL: %s', (url) => {
    expect(isTrustedPaymobCheckoutUrl(url)).toBe(false);
  });
});

describe('cash-only payment policy', () => {
  it('keeps COD selectable when card payments are disabled', async () => {
    const { isPaymentMethodEnabled } = await loadPaymentPolicy(false);

    expect(isPaymentMethodEnabled(paymentMethod('cash'))).toBe(true);
  });

  it.each<PaymentMethodKind>(['fawry', 'vodafone_cash', 'instapay', 'card', 'apple_pay'])(
    'does not offer persisted %s methods while the launch is cash-only',
    async (kind) => {
      const { isPaymentMethodEnabled } = await loadPaymentPolicy(false);

      expect(isPaymentMethodEnabled(paymentMethod(kind))).toBe(false);
    },
  );

  it('converts COD to the only supported order payment method', async () => {
    const { toOrderPaymentMethod } = await loadPaymentPolicy(false);

    expect(toOrderPaymentMethod('cash')).toBe('cash_on_delivery');
  });

  it.each<PaymentMethodKind>(['fawry', 'vodafone_cash', 'instapay', 'card', 'apple_pay'])(
    'rejects %s instead of silently converting it to COD',
    async (kind) => {
      const { toOrderPaymentMethod } = await loadPaymentPolicy(false);

      expect(() => toOrderPaymentMethod(kind)).toThrow(/not available/i);
    },
  );

  it.each<PaymentMethodKind>(['fawry', 'vodafone_cash', 'instapay'])(
    'keeps unimplemented %s disabled even when card payments are enabled',
    async (kind) => {
      const { isPaymentMethodEnabled, toOrderPaymentMethod } = await loadPaymentPolicy(true);

      expect(isPaymentMethodEnabled(paymentMethod(kind))).toBe(false);
      expect(() => toOrderPaymentMethod(kind)).toThrow(/not available/i);
    },
  );

  it('allows only implemented card rails when card payments are enabled', async () => {
    const { isPaymentMethodEnabled, toOrderPaymentMethod } = await loadPaymentPolicy(true);

    expect(isPaymentMethodEnabled(paymentMethod('card'))).toBe(true);
    expect(isPaymentMethodEnabled(paymentMethod('apple_pay'))).toBe(true);
    expect(toOrderPaymentMethod('card')).toBe('card');
    expect(toOrderPaymentMethod('apple_pay')).toBe('card');
  });
});
