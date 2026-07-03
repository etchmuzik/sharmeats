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
  'amount_cents',
  'created_at',
  'currency',
  'error_occured',
  'has_parent_transaction',
  'id',
  'integration_id',
  'is_3d_secure',
  'is_auth',
  'is_capture',
  'is_refunded',
  'is_standalone_payment',
  'is_voided',
  'order.id',
  'owner',
  'pending',
  'source_data.pan',
  'source_data.sub_type',
  'source_data.type',
  'success',
] as const;

/**
 * Build the exact string Paymob signs: each HMAC_FIELDS value (dot-path into the
 * transaction object), booleans as 'true'/'false', null/undefined as '', joined
 * with no separator. This is the string the SHA-512 HMAC is computed over.
 */
export function buildHmacString(obj: Record<string, unknown>): string {
  return HMAC_FIELDS.map((path) => {
    const val = path
      .split('.')
      .reduce<unknown>((acc, k) => (acc == null ? acc : (acc as Record<string, unknown>)[k]), obj);
    if (typeof val === 'boolean') return val ? 'true' : 'false';
    return val == null ? '' : String(val);
  }).join('');
}

/**
 * The decisive anti-fraud control: the SIGNED amount (amount_cents, which is in
 * HMAC_FIELDS so it is trustworthy) must equal what the located order owes.
 * total_egp is integer EGP; Paymob works in piastres = EGP * 100.
 * Returns true only when the amounts match exactly and the input is finite.
 */
export function amountMatches(signedAmountCents: unknown, orderTotalEgp: number): boolean {
  const signed = Number(signedAmountCents);
  const expected = orderTotalEgp * 100;
  return Number.isFinite(signed) && signed === expected;
}

/** True when Paymob signals the transaction succeeded (bool or the string 'true'). */
export function isSuccess(obj: Record<string, unknown>): boolean {
  return obj.success === true || obj.success === 'true';
}

/** Resolve our order id from the (unsigned) webhook fields, in priority order. */
export function resolveOrderId(obj: Record<string, any>): string | null {
  return obj.order?.merchant_order_id ?? obj.special_reference ?? obj.extras?.order_id ?? null;
}
