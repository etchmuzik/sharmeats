import { assertEquals, assertThrows } from "jsr:@std/assert@1";
import { hasAdminRefundAuthority, parseFullRefundRequest } from "./logic.ts";

Deno.test("refund authority requires both the admin role and aal2", () => {
  assertEquals(hasAdminRefundAuthority("admin", "aal1", "aal2"), false);
  assertEquals(hasAdminRefundAuthority("admin", "aal2", "aal2"), true);
  assertEquals(hasAdminRefundAuthority("dispatcher", "aal2", "aal2"), false);
  assertEquals(hasAdminRefundAuthority("admin", null, null), false);
  // Supabase reports aal2/aal1 when the JWT is stale after factor removal.
  assertEquals(hasAdminRefundAuthority("admin", "aal2", "aal1"), false);
});

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
