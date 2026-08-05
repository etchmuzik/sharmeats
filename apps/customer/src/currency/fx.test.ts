/**
 * Display FX (Package 05 Slice B groundwork).
 *
 * The module had NO tests while sitting in the checkout render path. The two
 * properties worth guarding hardest:
 *
 *   * EGP is authority — conversion is presentation, and the EGP formatting
 *     path must never depend on a rate;
 *   * junk from outside the type system (AsyncStorage, deep links) must
 *     normalize to EGP at the boundary instead of reaching the formatters,
 *     where an unknown currency used to render "undefinedNaN" and throw
 *     TypeError from `.toFixed(undefined)` — a checkout crash caused by a
 *     display preference.
 */
import { describe, it, expect } from 'vitest';
import {
  ALL_CURRENCIES,
  asSupportedCurrency,
  convertFromEgp,
  formatCurrency,
  formatCurrencyAtRate,
  fxRateLine,
  fxRateLineAtRate,
} from './fx';

describe('asSupportedCurrency (the boundary guard)', () => {
  it('passes every supported currency through unchanged', () => {
    for (const c of ALL_CURRENCIES) {
      expect(asSupportedCurrency(c)).toBe(c);
    }
  });

  it.each(['SAR', 'egp', 'usd', '', 'EUR ', 42, null, undefined, {}, ['EUR']])(
    'normalizes junk %j to EGP instead of letting it reach the formatters',
    (junk) => {
      expect(asSupportedCurrency(junk)).toBe('EGP');
    },
  );

  it('a normalized value can always be formatted — the crash path is closed', () => {
    // The exact failure: persisted "SAR" -> formatCurrency -> undefinedNaN,
    // fxRateLine -> .toFixed on undefined -> TypeError.
    const revived = asSupportedCurrency('SAR');
    expect(() => formatCurrency(1234, revived)).not.toThrow();
    expect(() => fxRateLine(revived)).not.toThrow();
    expect(formatCurrency(1234, revived)).toBe('EGP 1,234');
  });
});

describe('EGP authority', () => {
  it('EGP never converts and never shows decimals', () => {
    expect(convertFromEgp(1234, 'EGP')).toBe(1234);
    expect(formatCurrency(1234.4, 'EGP')).toBe('EGP 1,234');
  });

  it('EGP has no rate line — there is nothing to disclose', () => {
    expect(fxRateLine('EGP')).toBeNull();
  });
});

describe('display conversion', () => {
  it('divides by the per-unit rate', () => {
    // 100 EGP at 50 EGP/unit = 2 units. Uses relative math, not a pinned rate:
    // the static table is a manual ops value and MAY change; the arithmetic
    // contract may not.
    const eur = convertFromEgp(100, 'EUR');
    const line = fxRateLine('EUR');
    const rate = Number(/= (\d+\.\d+) EGP/.exec(line ?? '')?.[1]);
    expect(eur).toBeCloseTo(100 / rate, 6);
  });

  it('formats non-EGP with symbol and two decimals', () => {
    expect(formatCurrency(0, 'USD')).toBe('$0.00');
  });

  it('every non-EGP currency has a disclosed rate line', () => {
    for (const c of ALL_CURRENCIES.filter((x) => x !== 'EGP')) {
      expect(fxRateLine(c)).toMatch(new RegExp(`^1 ${c} = \\d+(\\.\\d+)? EGP$`));
    }
  });
});

describe('locale-aware FX display', () => {
  it('keeps every existing English conversion string when no locale is supplied', () => {
    expect(formatCurrencyAtRate(100, 'USD', 50)).toBe('$2.00');
    expect(fxRateLineAtRate('USD', 50)).toBe('1 USD = 50.00 EGP');
  });

  it('uses Egyptian Arabic digits and EGP notation for converted money', () => {
    expect(formatCurrencyAtRate(1_250, 'USD', 50, 'ar')).toBe('\u200F٢٥٫٠٠\u00A0US$');
    expect(formatCurrency(1_234.4, 'EGP', 'ar')).toBe('\u200F١٬٢٣٤\u00A0ج.م.\u200F');
  });

  it('uses Egyptian Arabic numbers and EGP notation in the rate disclosure', () => {
    expect(fxRateLineAtRate('EUR', 52.85, 'ar')).toBe('\u200F١\u00A0EUR = \u200F٥٢٫٨٥\u00A0ج.م.\u200F');
  });

  it('uses each supported locale’s regional number formatting outside English', () => {
    expect(formatCurrencyAtRate(1_234, 'EUR', 50, 'de')).toBe('24,68\u00A0€');
    expect(fxRateLineAtRate('EUR', 52.85, 'de')).toBe('1\u00A0EUR = 52,85\u00A0EGP');
  });
});
