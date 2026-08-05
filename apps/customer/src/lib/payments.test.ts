import { describe, expect, it } from 'vitest';
import { isTrustedPaymobCheckoutUrl } from './payments';

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
