import { describe, expect, it } from 'vitest';
import {
  dictionaries,
  localeDirection,
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

  it('localizes the tier screen labels rather than shipping English into Arabic', () => {
    // These were hardcoded in app/tier.tsx until 2026-08-17 and silently
    // rendered English inside an RTL screen. Assert a few of the values that
    // interpolate, since those are the ones a naive translation breaks.
    expect(translate('ar', 'tier.heading', { tier: translate('ar', 'tier.nameGold') })).toBe(
      'المستوى ذهبي',
    );
    expect(translate('ar', 'tier.ordersToNext', { count: 7 })).toBe('7 طلبات إضافية للمستوى التالي');
    expect(translate('en', 'tier.progressValueTop')).toBe('Top tier reached');
  });

  it('localizes sign-in, chat and boot copy', () => {
    for (const key of [
      'signin.title',
      'signin.subtitle',
      'signin.forgotLink',
      'chat.inputPlaceholder',
      'chat.emptyHint',
      'boot.backendTitle',
      'kyc.permissionBody',
    ] as const) {
      // Arabic must differ from English: an untranslated copy-paste is the
      // failure this catches, and the parity test above cannot see it.
      expect(translate('ar', key)).not.toBe(translate('en', key));
    }
  });
});
