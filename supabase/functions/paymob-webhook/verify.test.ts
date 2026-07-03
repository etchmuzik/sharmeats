// Tests for the Paymob webhook's money-security invariants.
// Run: deno test supabase/functions/paymob-webhook/verify.test.ts
import { assertEquals } from 'jsr:@std/assert@1';
import { createHmac } from 'node:crypto';
import { amountMatches, buildHmacString, HMAC_FIELDS, isSuccess, resolveOrderId } from './verify.ts';

// A representative Paymob transaction object with every signed field populated.
function sampleObj(): Record<string, unknown> {
  return {
    amount_cents: 15000,
    created_at: '2026-07-03T10:00:00Z',
    currency: 'EGP',
    error_occured: false,
    has_parent_transaction: false,
    id: 987654,
    integration_id: 111,
    is_3d_secure: true,
    is_auth: false,
    is_capture: false,
    is_refunded: false,
    is_standalone_payment: true,
    is_voided: false,
    order: { id: 555, merchant_order_id: 'SE-ABC123' },
    owner: 42,
    pending: false,
    source_data: { pan: '2346', sub_type: 'MasterCard', type: 'card' },
    success: true,
  };
}

Deno.test('buildHmacString: field order + boolean/null coercion is exact', () => {
  const s = buildHmacString(sampleObj());
  // amount_cents(15000) created_at currency error_occured(false) has_parent(false)
  // id(987654) integration_id(111) is_3d_secure(true) is_auth(false) is_capture(false)
  // is_refunded(false) is_standalone(true) is_voided(false) order.id(555) owner(42)
  // pending(false) pan(2346) sub_type(MasterCard) type(card) success(true)
  assertEquals(
    s,
    '15000' +
      '2026-07-03T10:00:00Z' +
      'EGP' +
      'false' +
      'false' +
      '987654' +
      '111' +
      'true' +
      'false' +
      'false' +
      'false' +
      'true' +
      'false' +
      '555' +
      '42' +
      'false' +
      '2346' +
      'MasterCard' +
      'card' +
      'true',
  );
});

Deno.test('buildHmacString: missing/null nested fields become empty string, not "undefined"', () => {
  const obj = sampleObj();
  delete (obj as Record<string, unknown>).source_data; // drop nested object
  const s = buildHmacString(obj);
  // Must not contain the literal 'undefined' — a wrong coercion would silently
  // change the signed string and break verification for real payments.
  assertEquals(s.includes('undefined'), false);
});

Deno.test('buildHmacString: a signed HMAC round-trips (forgery-detection sanity)', () => {
  const secret = 'test_hmac_secret';
  const obj = sampleObj();
  const good = createHmac('sha512', secret).update(buildHmacString(obj)).digest('hex');

  // Tampering with a signed field (amount) must change the HMAC.
  const tampered = { ...obj, amount_cents: 1 };
  const bad = createHmac('sha512', secret).update(buildHmacString(tampered)).digest('hex');
  assertEquals(good === bad, false);
});

Deno.test('HMAC_FIELDS: exactly the 20 documented fields, no drift', () => {
  assertEquals(HMAC_FIELDS.length, 20);
  assertEquals(HMAC_FIELDS[0], 'amount_cents');
  assertEquals(HMAC_FIELDS[HMAC_FIELDS.length - 1], 'success');
});

Deno.test('amountMatches: signed piastres must equal total_egp * 100', () => {
  assertEquals(amountMatches(15000, 150), true); // 150 EGP == 15000 piastres
  assertEquals(amountMatches(15000, 149), false); // underpay by 1 EGP
  assertEquals(amountMatches(14999, 150), false); // underpay by 1 piastre
  assertEquals(amountMatches(1500000, 150), false); // 100x overpay (units confusion)
});

Deno.test('amountMatches: rejects non-finite / garbage signed amounts', () => {
  assertEquals(amountMatches('abc', 150), false);
  assertEquals(amountMatches(NaN, 150), false);
  assertEquals(amountMatches(Infinity, 150), false);
  assertEquals(amountMatches(null, 150), false);
  assertEquals(amountMatches(undefined, 150), false);
});

Deno.test('amountMatches: numeric string that equals the amount still matches', () => {
  // Paymob sometimes sends amount_cents as a string; Number() coercion must handle it.
  assertEquals(amountMatches('15000', 150), true);
});

Deno.test('isSuccess: accepts boolean true and string "true" only', () => {
  assertEquals(isSuccess({ success: true }), true);
  assertEquals(isSuccess({ success: 'true' }), true);
  assertEquals(isSuccess({ success: false }), false);
  assertEquals(isSuccess({ success: 'false' }), false);
  assertEquals(isSuccess({ success: 1 }), false); // truthy but not accepted
  assertEquals(isSuccess({}), false);
});

Deno.test('resolveOrderId: priority merchant_order_id > special_reference > extras.order_id', () => {
  assertEquals(
    resolveOrderId({ order: { merchant_order_id: 'A' }, special_reference: 'B', extras: { order_id: 'C' } }),
    'A',
  );
  assertEquals(resolveOrderId({ special_reference: 'B', extras: { order_id: 'C' } }), 'B');
  assertEquals(resolveOrderId({ extras: { order_id: 'C' } }), 'C');
  assertEquals(resolveOrderId({}), null);
});
