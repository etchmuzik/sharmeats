// Tests for the Paymob webhook's money-security invariants.
// Run: deno test supabase/functions/paymob-webhook/verify.test.ts
import { assertEquals } from "jsr:@std/assert@1";
import { createHmac } from "node:crypto";
import {
  attemptStatusAfterFailedTransaction,
  amountMatches,
  buildHmacString,
  HMAC_FIELDS,
  isSuccess,
  resolveSignedProviderOrderId,
  signedTransactionId,
} from "./verify.ts";

// A representative Paymob transaction object with every signed field populated.
function sampleObj(): Record<string, unknown> {
  return {
    amount_cents: 15000,
    created_at: "2026-07-03T10:00:00Z",
    currency: "EGP",
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
    order: { id: 555, merchant_order_id: "SE-ABC123" },
    owner: 42,
    pending: false,
    source_data: { pan: "2346", sub_type: "MasterCard", type: "card" },
    success: true,
  };
}

Deno.test("buildHmacString: field order + boolean/null coercion is exact", () => {
  const s = buildHmacString(sampleObj());
  // amount_cents(15000) created_at currency error_occured(false) has_parent(false)
  // id(987654) integration_id(111) is_3d_secure(true) is_auth(false) is_capture(false)
  // is_refunded(false) is_standalone(true) is_voided(false) order.id(555) owner(42)
  // pending(false) pan(2346) sub_type(MasterCard) type(card) success(true)
  assertEquals(
    s,
    "15000" +
      "2026-07-03T10:00:00Z" +
      "EGP" +
      "false" +
      "false" +
      "987654" +
      "111" +
      "true" +
      "false" +
      "false" +
      "false" +
      "true" +
      "false" +
      "555" +
      "42" +
      "false" +
      "2346" +
      "MasterCard" +
      "card" +
      "true",
  );
});

Deno.test('buildHmacString: missing/null nested fields become empty string, not "undefined"', () => {
  const obj = sampleObj();
  delete (obj as Record<string, unknown>).source_data; // drop nested object
  const s = buildHmacString(obj);
  // Must not contain the literal 'undefined' — a wrong coercion would silently
  // change the signed string and break verification for real payments.
  assertEquals(s.includes("undefined"), false);
});

Deno.test("buildHmacString: a signed HMAC round-trips (forgery-detection sanity)", () => {
  const secret = "test_hmac_secret";
  const obj = sampleObj();
  const good = createHmac("sha512", secret).update(buildHmacString(obj)).digest(
    "hex",
  );

  // Tampering with a signed field (amount) must change the HMAC.
  const tampered = { ...obj, amount_cents: 1 };
  const bad = createHmac("sha512", secret).update(buildHmacString(tampered))
    .digest("hex");
  assertEquals(good === bad, false);
});

Deno.test("HMAC_FIELDS: exactly the 20 documented fields, no drift", () => {
  assertEquals(HMAC_FIELDS.length, 20);
  assertEquals(HMAC_FIELDS[0], "amount_cents");
  assertEquals(HMAC_FIELDS[HMAC_FIELDS.length - 1], "success");
});

Deno.test("amountMatches: signed piastres must equal total_egp * 100", () => {
  assertEquals(amountMatches(15000, 150), true); // 150 EGP == 15000 piastres
  assertEquals(amountMatches(15000, 149), false); // underpay by 1 EGP
  assertEquals(amountMatches(14999, 150), false); // underpay by 1 piastre
  assertEquals(amountMatches(1500000, 150), false); // 100x overpay (units confusion)
});

Deno.test("amountMatches: rejects non-finite / garbage signed amounts", () => {
  assertEquals(amountMatches("abc", 150), false);
  assertEquals(amountMatches(NaN, 150), false);
  assertEquals(amountMatches(Infinity, 150), false);
  assertEquals(amountMatches(null, 150), false);
  assertEquals(amountMatches(undefined, 150), false);
});

Deno.test("amountMatches: numeric string that equals the amount still matches", () => {
  // Paymob sometimes sends amount_cents as a string; Number() coercion must handle it.
  assertEquals(amountMatches("15000", 150), true);
});

Deno.test('isSuccess: accepts boolean true and string "true" only', () => {
  assertEquals(isSuccess({ success: true }), true);
  assertEquals(isSuccess({ success: "true" }), true);
  assertEquals(isSuccess({ success: false }), false);
  assertEquals(isSuccess({ success: "false" }), false);
  assertEquals(isSuccess({ success: 1 }), false); // truthy but not accepted
  assertEquals(isSuccess({}), false);
});

Deno.test("resolveSignedProviderOrderId: trusts only the HMAC-covered order.id", () => {
  assertEquals(
    resolveSignedProviderOrderId({
      order: { id: 264064419, merchant_order_id: "victim-order" },
      special_reference: "attacker-controlled",
      extras: { order_id: "attacker-controlled" },
    }),
    "264064419",
  );
  assertEquals(
    resolveSignedProviderOrderId({ order: { id: "provider-order" } }),
    "provider-order",
  );
});

Deno.test("resolveSignedProviderOrderId: rejects unsigned references and malformed ids", () => {
  assertEquals(resolveSignedProviderOrderId({ special_reference: "B" }), null);
  assertEquals(
    resolveSignedProviderOrderId({ extras: { order_id: "C" } }),
    null,
  );
  assertEquals(resolveSignedProviderOrderId({ order: { id: "" } }), null);
  assertEquals(resolveSignedProviderOrderId({ order: { id: null } }), null);
  assertEquals(resolveSignedProviderOrderId({}), null);
});

Deno.test("signedTransactionId: accepts only a non-empty HMAC-covered transaction id", () => {
  assertEquals(signedTransactionId({ id: 987654 }), "987654");
  assertEquals(signedTransactionId({ id: "txn-1" }), "txn-1");
  assertEquals(signedTransactionId({ id: "" }), null);
  assertEquals(signedTransactionId({ id: null }), null);
});

Deno.test("a failed transaction keeps its bound checkout reusable", () => {
  assertEquals(attemptStatusAfterFailedTransaction("ready"), "ready");
  assertEquals(attemptStatusAfterFailedTransaction("creating"), "creating");
  assertEquals(attemptStatusAfterFailedTransaction("paid"), "paid");
});
