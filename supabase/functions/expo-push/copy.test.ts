// Tests for the expo-push localized copy module (audit N4).
// Run: deno test supabase/functions/expo-push/copy.test.ts
import { assertEquals } from 'jsr:@std/assert@1';
import { COPY, FALLBACK_COPY, normalizeLocale, resolveCopy, SUPPORTED_LOCALES } from './copy.ts';

// Keys the N7 migration will start emitting; they must ship in the function first.
const NEW_N7_KEYS = [
  'order_cancelled_driver',
  'settlement_finalized',
  'settlement_paid',
  'kyc_approved',
  'kyc_rejected',
  'kyc_submitted',
];

Deno.test('normalizeLocale: known locales map to themselves', () => {
  for (const locale of SUPPORTED_LOCALES) {
    assertEquals(normalizeLocale(locale), locale);
  }
});

Deno.test('normalizeLocale: casing, whitespace, and region tags are normalized', () => {
  assertEquals(normalizeLocale('AR'), 'ar');
  assertEquals(normalizeLocale('ar-EG'), 'ar');
  assertEquals(normalizeLocale('de_DE'), 'de');
  assertEquals(normalizeLocale('ru-RU'), 'ru');
  assertEquals(normalizeLocale(' it '), 'it');
  assertEquals(normalizeLocale('en-US'), 'en');
});

Deno.test('normalizeLocale: unknown / null / empty fall back to en (guests)', () => {
  assertEquals(normalizeLocale('fr'), 'en'); // unsupported language
  assertEquals(normalizeLocale('zz-ZZ'), 'en');
  assertEquals(normalizeLocale(''), 'en');
  assertEquals(normalizeLocale(null), 'en'); // guest / users.locale NULL
  assertEquals(normalizeLocale(undefined), 'en');
});

Deno.test('resolveCopy: known event returns the copy for that locale', () => {
  assertEquals(resolveCopy('order_paid', 'ar'), COPY.ar.order_paid);
  assertEquals(resolveCopy('order_delivered', 'ru'), COPY.ru.order_delivered);
  assertEquals(resolveCopy('new_offer', 'it'), COPY.it.new_offer);
  assertEquals(resolveCopy('kyc_approved', 'de'), COPY.de.kyc_approved);
  // Localized copy actually differs from English.
  assertEquals(resolveCopy('order_paid', 'ar').title === COPY.en.order_paid.title, false);
});

Deno.test('resolveCopy: unknown / null locale gets English copy', () => {
  assertEquals(resolveCopy('order_paid', 'fr'), COPY.en.order_paid);
  assertEquals(resolveCopy('order_paid', null), COPY.en.order_paid);
  assertEquals(resolveCopy('order_paid', undefined), COPY.en.order_paid);
});

Deno.test('resolveCopy: unknown event falls back to the per-locale generic copy', () => {
  assertEquals(resolveCopy('some_future_event', 'ru'), FALLBACK_COPY.ru);
  assertEquals(resolveCopy('some_future_event', 'ar'), FALLBACK_COPY.ar);
  // English generic fallback matches the pre-N4 hardcoded strings exactly.
  assertEquals(resolveCopy('some_future_event', 'en'), { title: 'Sharm Eats', body: 'Order update' });
  // Unknown event AND unknown locale -> English generic fallback.
  assertEquals(resolveCopy('some_future_event', 'fr'), FALLBACK_COPY.en);
});

Deno.test('parity: every event key exists in all 5 locales with non-empty copy', () => {
  const enKeys = Object.keys(COPY.en).sort();
  for (const locale of SUPPORTED_LOCALES) {
    assertEquals(
      Object.keys(COPY[locale]).sort(),
      enKeys,
      `locale ${locale} key set drifted from en`,
    );
    for (const [event, copy] of Object.entries(COPY[locale])) {
      assertEquals(copy.title.trim().length > 0, true, `${locale}.${event}.title is empty`);
      assertEquals(copy.body.trim().length > 0, true, `${locale}.${event}.body is empty`);
    }
  }
});

Deno.test('parity: the 6 new N7 event keys exist in every locale', () => {
  for (const locale of SUPPORTED_LOCALES) {
    for (const key of NEW_N7_KEYS) {
      assertEquals(key in COPY[locale], true, `${locale} is missing ${key}`);
    }
  }
});

Deno.test('en copy for pre-existing events is unchanged (behavior lock)', () => {
  // Spot-checks against the pre-N4 hardcoded English map — en users must see
  // byte-identical pushes after this refactor.
  assertEquals(COPY.en.order_paid, {
    title: 'Payment confirmed',
    body: 'Your order is confirmed and sent to the kitchen.',
  });
  assertEquals(COPY.en.order_delivered, {
    title: 'Delivered',
    body: 'Enjoy your meal! Tap to rate your order.',
  });
  assertEquals(COPY.en.new_offer, { title: 'New delivery offer', body: 'You have a new job. Tap to accept.' });
  assertEquals(COPY.en.tier_promoted, {
    title: 'You leveled up!',
    body: 'You reached a new rewards tier. Tap to see your new perks.',
  });
});

Deno.test('no em dashes in translations or in any new event copy', () => {
  // Legacy en strings predate this rule and are locked byte-identical above;
  // everything written for N4 (all non-en copy + the 6 new keys) must be clean.
  for (const locale of SUPPORTED_LOCALES) {
    for (const [event, copy] of Object.entries(COPY[locale])) {
      if (locale === 'en' && !NEW_N7_KEYS.includes(event)) continue;
      assertEquals(copy.title.includes('—'), false, `${locale}.${event}.title has an em dash`);
      assertEquals(copy.body.includes('—'), false, `${locale}.${event}.body has an em dash`);
    }
    assertEquals(FALLBACK_COPY[locale].body.includes('—'), false);
  }
});
