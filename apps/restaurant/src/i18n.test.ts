import { describe, expect, it } from 'vitest';
import {
  deviceLocale,
  dictionaries,
  localeDirection,
  localeFromLanguageTag,
  nextLocale,
  normalizeLocale,
  supportedLocales,
  translate,
  type TranslationKey,
} from './i18n';

describe('restaurant operational translations', () => {
  it('ships the supported English and Arabic locales', () => {
    expect(supportedLocales).toEqual(['en', 'ar']);
  });

  it('keeps every locale complete and non-empty', () => {
    const englishKeys = Object.keys(dictionaries.en).sort();

    for (const locale of supportedLocales) {
      expect(Object.keys(dictionaries[locale]).sort()).toEqual(englishKeys);
      expect(Object.values(dictionaries[locale]).every((value) => value.trim().length > 0)).toBe(
        true,
      );
    }
  });

  it('interpolates operational values without changing order codes or numerals', () => {
    expect(
      translate('ar', 'order.openA11y', {
        code: 'A4F2',
        amount: 325,
        payment: translate('ar', 'payment.cash'),
      }),
    ).toBe('فتح الطلب A4F2، 325 EGP، الدفع نقداً عند الاستلام');
  });

  it('builds a localized partial brand-update failure without changing counts or names', () => {
    expect(
      translate('ar', 'home.brandUpdatePartial', {
        updated: 1,
        total: 3,
        state: translate('ar', 'home.brandStateClosed'),
        brands: 'Smash',
        cause: translate('ar', 'home.updateFailed'),
      }),
    ).toBe('تم تحديث 1 من 3 علامات — ما زالت مغلقة: Smash (تعذر التحديث)');
  });

  it('returns the expected reading direction', () => {
    expect(localeDirection('en')).toBe('ltr');
    expect(localeDirection('ar')).toBe('rtl');
  });

  it('switches between the two operational locales', () => {
    expect(nextLocale('en')).toBe('ar');
    expect(nextLocale('ar')).toBe('en');
  });

  it('normalizes persisted values defensively', () => {
    expect(normalizeLocale('ar')).toBe('ar');
    expect(normalizeLocale('en')).toBe('en');
    expect(normalizeLocale('AR')).toBe('en');
    expect(normalizeLocale(null)).toBe('en');
  });

  it('requires a valid typed translation key at runtime', () => {
    const key: TranslationKey = 'queue.new';
    expect(translate('ar', key)).toBe('جديد');
  });
});

describe('device language detection', () => {
  it('accepts a region subtag and any casing, unlike the persisted-value guard', () => {
    expect(localeFromLanguageTag('ar')).toBe('ar');
    expect(localeFromLanguageTag('ar-EG')).toBe('ar');
    expect(localeFromLanguageTag('AR-eg')).toBe('ar');
    expect(localeFromLanguageTag('en-GB')).toBe('en');
    expect(localeFromLanguageTag('ru-RU')).toBe('en');
  });

  it('falls back to English rather than throwing on nonsense', () => {
    expect(localeFromLanguageTag(null)).toBe('en');
    expect(localeFromLanguageTag('')).toBe('en');
    expect(localeFromLanguageTag(undefined)).toBe('en');
  });

  it('always resolves to a supported locale', () => {
    expect(supportedLocales).toContain(deviceLocale());
  });
});
