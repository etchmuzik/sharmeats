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

// ---------------------------------------------------------------------------
// [E0] Vertical-aware copy.
//
// The base COPY map is FOOD copy ("sent to the kitchen", "Enjoy your meal!").
// These assert that a non-food order never inherits it — the failure mode being
// a pharmacy customer told to enjoy their meal, on a lock screen, about a
// prescription.
// ---------------------------------------------------------------------------

const FOOD_WORDS = /kitchen|meal|restaurant|مطعم|ресторан|ristorante|Restaurant/i;

Deno.test('food copy is UNCHANGED — the behaviour lock still holds', () => {
  // Explicit vertical, omitted vertical, and null must all give food copy:
  // every current order is food, and today's customers must see no change.
  for (const v of ['food', undefined, null]) {
    assertEquals(resolveCopy('order_delivered', 'en', v as string | null | undefined), {
      title: 'Delivered',
      body: 'Enjoy your meal! Tap to rate your order.',
    });
  }
});

Deno.test('grocery never inherits restaurant language', () => {
  for (const locale of SUPPORTED_LOCALES) {
    for (const event of ['order_paid', 'order_accepted', 'order_delivered',
                         'order_rejected', 'driver_assigned', 'order_ready_pickup']) {
      const c = resolveCopy(event, locale, 'grocery');
      assertEquals(
        FOOD_WORDS.test(`${c.title} ${c.body}`), false,
        `grocery/${locale}/${event} leaked food wording: ${c.title} — ${c.body}`,
      );
      assertEquals(c.title.length > 0 && c.body.length > 0, true,
        `grocery/${locale}/${event} has empty copy`);
    }
  }
});

Deno.test('pharmacy never inherits restaurant language', () => {
  for (const locale of SUPPORTED_LOCALES) {
    for (const event of ['order_paid', 'order_accepted', 'order_delivered',
                         'order_rejected', 'driver_assigned', 'order_ready_pickup']) {
      const c = resolveCopy(event, locale, 'pharmacy');
      assertEquals(
        FOOD_WORDS.test(`${c.title} ${c.body}`), false,
        `pharmacy/${locale}/${event} leaked food wording: ${c.title} — ${c.body}`,
      );
    }
  }
});

Deno.test('pharmacy copy never names the goods (lock-screen privacy)', () => {
  // A push preview is readable by anyone holding the phone. Naming a medicine,
  // a category, or even "prescription" on the lock screen is a disclosure the
  // customer did not choose to make.
  // Naming the MERCHANT ("the pharmacy", "la farmacia") is unavoidable and is
  // what every other vertical does too. What must never appear is the GOODS:
  // a medicine, a drug class, or the word prescription. An earlier version of
  // this test also matched /farmac[oi]/, which flagged the Italian word for
  // "pharmacy" itself — an over-broad pattern, not a real disclosure.
  const SENSITIVE = /prescription|medicine|medication|\bdrugs?\b|\bpills?\b|وصفة|دواء|رецепт|лекарств|ricetta|medicinal|farmaco\b|farmaci\b|Rezept|Medikament/i;
  for (const locale of SUPPORTED_LOCALES) {
    for (const event of Object.keys(COPY.en)) {
      const c = resolveCopy(event, locale, 'pharmacy');
      assertEquals(
        SENSITIVE.test(`${c.title} ${c.body}`), false,
        `pharmacy/${locale}/${event} names the goods: ${c.title} — ${c.body}`,
      );
    }
  }
});

Deno.test('an UNKNOWN vertical falls back to generic, never to food', () => {
  // The real risk: a vertical added later inherits "Enjoy your meal!" because
  // nobody remembered to add copy for it.
  for (const locale of SUPPORTED_LOCALES) {
    for (const event of ['order_paid', 'order_accepted', 'order_delivered',
                         'order_rejected', 'driver_assigned', 'order_ready_pickup']) {
      const c = resolveCopy(event, locale, 'flowers');
      assertEquals(
        FOOD_WORDS.test(`${c.title} ${c.body}`), false,
        `unknown vertical ${locale}/${event} fell back to FOOD copy: ${c.body}`,
      );
      assertEquals(c.body.length > 0, true, `unknown vertical ${locale}/${event} empty`);
    }
  }
});

Deno.test('vertical-neutral events are identical across verticals', () => {
  // payment_failed, new_message, credit_issued … say nothing about goods, so
  // they must NOT diverge — divergence would be pointless translation drift.
  for (const locale of SUPPORTED_LOCALES) {
    for (const event of ['payment_failed', 'new_message', 'credit_issued', 'support_reply']) {
      const food = resolveCopy(event, locale, 'food');
      for (const v of ['grocery', 'pharmacy', 'flowers']) {
        assertEquals(resolveCopy(event, locale, v), food,
          `${event} needlessly diverged for ${v}/${locale}`);
      }
    }
  }
});

Deno.test('vertical id is normalised (casing and whitespace)', () => {
  const canonical = resolveCopy('order_delivered', 'en', 'pharmacy');
  for (const raw of ['Pharmacy', 'PHARMACY', '  pharmacy  ']) {
    assertEquals(resolveCopy('order_delivered', 'en', raw), canonical,
      `vertical '${raw}' was not normalised`);
  }
});

Deno.test('parity: every vertical-sensitive event has copy in all 5 locales', () => {
  // The six events whose food wording is vertical-specific. Listed explicitly
  // rather than imported from a private const, so the test states the contract
  // instead of restating the implementation.
  const SENSITIVE_EVENTS = ['order_paid', 'order_accepted', 'order_delivered',
                            'order_rejected', 'driver_assigned', 'order_ready_pickup'];
  for (const v of ['grocery', 'pharmacy']) {
    for (const locale of SUPPORTED_LOCALES) {
      for (const event of SENSITIVE_EVENTS) {
        const c = resolveCopy(event, locale, v);
        assertEquals(c.title.length > 0 && c.body.length > 0, true,
          `${v}/${locale}/${event} is missing copy`);
      }
    }
  }
});
