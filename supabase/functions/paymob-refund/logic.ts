interface FullRefundRequest {
  orderId: string;
  reason: string | null;
}

/**
 * Refunds move real money, so an admin role alone is insufficient. The caller's
 * token has already been validated with auth.getUser(); this predicate binds
 * that identity to Supabase's current authenticator assurance result.
 */
export function hasAdminRefundAuthority(
  role: string | null | undefined,
  currentLevel: string | null | undefined,
  nextLevel: string | null | undefined,
): boolean {
  return role === "admin" && currentLevel === "aal2" && nextLevel === "aal2";
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
