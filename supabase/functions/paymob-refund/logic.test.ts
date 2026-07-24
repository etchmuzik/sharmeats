import { assertEquals, assertThrows } from "jsr:@std/assert@1";
import { parseFullRefundRequest } from "./logic.ts";

Deno.test("parseFullRefundRequest accepts a full-refund request", () => {
  assertEquals(
    parseFullRefundRequest({
      orderId: "order-1",
      reason: "Customer cancellation",
    }),
    { orderId: "order-1", reason: "Customer cancellation" },
  );
});

Deno.test("parseFullRefundRequest normalizes an omitted reason", () => {
  assertEquals(parseFullRefundRequest({ orderId: "order-1" }), {
    orderId: "order-1",
    reason: null,
  });
});

Deno.test("parseFullRefundRequest rejects partial refund fields", () => {
  assertThrows(
    () => parseFullRefundRequest({ orderId: "order-1", amountEgp: 10 }),
    Error,
    "FULL_REFUNDS_ONLY",
  );
});

Deno.test("parseFullRefundRequest rejects malformed input", () => {
  assertThrows(() => parseFullRefundRequest({}), Error, "ORDER_ID_REQUIRED");
  assertThrows(
    () => parseFullRefundRequest({ orderId: "" }),
    Error,
    "ORDER_ID_REQUIRED",
  );
  assertThrows(
    () =>
      parseFullRefundRequest({ orderId: "order-1", reason: "x".repeat(501) }),
    Error,
    "REASON_TOO_LONG",
  );
});
