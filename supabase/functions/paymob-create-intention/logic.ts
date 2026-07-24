type JsonObject = Record<string, unknown>;
type PaymentAttemptStatus = "creating" | "ready" | "paid" | "failed" | "expired";

function nonEmptyId(value: unknown): string | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const normalized = String(value).trim();
  return normalized.length > 0 ? normalized : null;
}

/**
 * A `ready` attempt has already been handed to the customer and must never be
 * expired automatically: Paymob could still accept that checkout, making a new
 * intention a double-charge risk. Only an ambiguous create call whose secret
 * was never returned to the customer can age out automatically.
 */
export function attemptCanAutoExpire(status: PaymentAttemptStatus): boolean {
  return status === "creating";
}

/**
 * Paymob has returned the provider order identifier in more than one response
 * shape across Intention API revisions. Normalize the supported shapes and fail
 * closed when the identifier is absent: the webhook cannot be securely bound
 * to a Sharm Eats order without it.
 */
export function resolveProviderOrderId(intention: JsonObject): string | null {
  const order = intention.order;
  const nestedOrderId = order && typeof order === "object"
    ? (order as JsonObject).id
    : null;
  return (
    nonEmptyId(intention.intention_order_id) ??
      nonEmptyId(nestedOrderId) ??
      nonEmptyId(intention.order_id)
  );
}

export function resolveProviderIntentionId(
  intention: JsonObject,
): string | null {
  return nonEmptyId(intention.id);
}

export function checkoutResponse(
  baseUrl: string,
  publicKey: string,
  clientSecret: string,
) {
  return {
    clientSecret,
    checkoutUrl: `${baseUrl}/unifiedcheckout/?publicKey=${
      encodeURIComponent(publicKey)
    }&clientSecret=${encodeURIComponent(clientSecret)}`,
  };
}
