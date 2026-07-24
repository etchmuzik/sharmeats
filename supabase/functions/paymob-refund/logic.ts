interface FullRefundRequest {
  orderId: string;
  reason: string | null;
}

export function parseFullRefundRequest(input: unknown): FullRefundRequest {
  if (!input || typeof input !== "object") throw new Error("ORDER_ID_REQUIRED");
  const body = input as Record<string, unknown>;
  if ("amountEgp" in body || "amountCents" in body) {
    throw new Error("FULL_REFUNDS_ONLY");
  }

  const orderId = typeof body.orderId === "string" ? body.orderId.trim() : "";
  if (!orderId) throw new Error("ORDER_ID_REQUIRED");

  if (body.reason != null && typeof body.reason !== "string") {
    throw new Error("INVALID_REASON");
  }
  const reason = typeof body.reason === "string" ? body.reason.trim() : "";
  if (reason.length > 500) throw new Error("REASON_TOO_LONG");

  return { orderId, reason: reason || null };
}
