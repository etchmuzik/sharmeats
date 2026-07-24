// Pure, dependency-free verification helpers for the Paymob webhook.
//
// Extracted from index.ts so the two money-security invariants — the HMAC
// concatenation string and the signed-amount assertion — are unit-testable
// without a running Deno server or a real HMAC secret. index.ts imports these;
// behaviour is unchanged.

// Fields Paymob concatenates (documented order) to compute the HMAC. This exact
// ordering IS the signature contract — a wrong order silently breaks every
// verification (or, far worse, could let a forged payload verify).
export const HMAC_FIELDS = [
  "amount_cents",
  "created_at",
  "currency",
  "error_occured",
  "has_parent_transaction",
  "id",
  "integration_id",
  "is_3d_secure",
  "is_auth",
  "is_capture",
  "is_refunded",
  "is_standalone_payment",
  "is_voided",
  "order.id",
  "owner",
  "pending",
  "source_data.pan",
  "source_data.sub_type",
  "source_data.type",
  "success",
] as const;

/**
 * Build the exact string Paymob signs: each HMAC_FIELDS value (dot-path into the
 * transaction object), booleans as 'true'/'false', null/undefined as '', joined
 * with no separator. This is the string the SHA-512 HMAC is computed over.
 */
export function buildHmacString(obj: Record<string, unknown>): string {
  return HMAC_FIELDS.map((path) => {
    const val = path
      .split(".")
      .reduce<unknown>(
        (acc, k) => (acc == null ? acc : (acc as Record<string, unknown>)[k]),
        obj,
      );
    if (typeof val === "boolean") return val ? "true" : "false";
    return val == null ? "" : String(val);
  }).join("");
}

/**
 * The decisive anti-fraud control: the SIGNED amount (amount_cents, which is in
 * HMAC_FIELDS so it is trustworthy) must equal what the located order owes.
 * total_egp is integer EGP; Paymob works in piastres = EGP * 100.
 * Returns true only when the amounts match exactly and the input is finite.
 */
export function amountMatches(
  signedAmountCents: unknown,
  orderTotalEgp: number,
): boolean {
  const signed = Number(signedAmountCents);
  const expected = orderTotalEgp * 100;
  return Number.isFinite(signed) && signed === expected;
}

/** True when Paymob signals the transaction succeeded (bool or the string 'true'). */
export function isSuccess(obj: Record<string, unknown>): boolean {
  return obj.success === true || obj.success === "true";
}

/**
 * A failed transaction does not prove the hosted checkout is unusable. Keeping
 * the attempt bound lets the customer retry the same Paymob intention and
 * prevents a second concurrently chargeable checkout from being created.
 */
export function attemptStatusAfterFailedTransaction<T extends string>(
  currentStatus: T,
): T {
  return currentStatus;
}

function nonEmptySignedId(value: unknown): string | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const normalized = String(value).trim();
  return normalized.length > 0 ? normalized : null;
}

/**
 * Resolve the Paymob order id from `order.id`, which is covered by the HMAC.
 * `merchant_order_id`, `special_reference`, and `extras` are deliberately
 * ignored: a caller can alter those fields without invalidating the signature.
 */
export function resolveSignedProviderOrderId(
  obj: Record<string, unknown>,
): string | null {
  const order = obj.order;
  if (!order || typeof order !== "object") return null;
  return nonEmptySignedId((order as Record<string, unknown>).id);
}

/** `id` is the HMAC-covered Paymob transaction identifier. */
export function signedTransactionId(
  obj: Record<string, unknown>,
): string | null {
  return nonEmptySignedId(obj.id);
}
