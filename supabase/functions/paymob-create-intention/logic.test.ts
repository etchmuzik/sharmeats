import { assertEquals } from "jsr:@std/assert@1";
import {
  attemptCanAutoExpire,
  checkoutResponse,
  resolveProviderIntentionId,
  resolveProviderOrderId,
} from "./logic.ts";

Deno.test("resolveProviderOrderId accepts documented/known Paymob intention shapes", () => {
  assertEquals(
    resolveProviderOrderId({ intention_order_id: 264064419 }),
    "264064419",
  );
  assertEquals(
    resolveProviderOrderId({ order: { id: 264064420 } }),
    "264064420",
  );
  assertEquals(resolveProviderOrderId({ order_id: "264064421" }), "264064421");
});

Deno.test("resolveProviderOrderId rejects missing and empty provider identifiers", () => {
  assertEquals(resolveProviderOrderId({}), null);
  assertEquals(resolveProviderOrderId({ intention_order_id: "" }), null);
  assertEquals(resolveProviderOrderId({ order: { id: null } }), null);
});

Deno.test("resolveProviderIntentionId normalizes the provider intention id", () => {
  assertEquals(
    resolveProviderIntentionId({ id: "pi_test_123" }),
    "pi_test_123",
  );
  assertEquals(resolveProviderIntentionId({ id: 123 }), "123");
  assertEquals(resolveProviderIntentionId({}), null);
});

Deno.test("checkoutResponse returns only the customer checkout contract", () => {
  assertEquals(
    checkoutResponse("https://accept.paymob.com", "pk_test", "secret"),
    {
      clientSecret: "secret",
      checkoutUrl:
        "https://accept.paymob.com/unifiedcheckout/?publicKey=pk_test&clientSecret=secret",
    },
  );
});

Deno.test("only an undelivered creating attempt may auto-expire", () => {
  assertEquals(attemptCanAutoExpire("creating"), true);
  assertEquals(attemptCanAutoExpire("ready"), false);
  assertEquals(attemptCanAutoExpire("paid"), false);
  assertEquals(attemptCanAutoExpire("failed"), false);
  assertEquals(attemptCanAutoExpire("expired"), false);
});
