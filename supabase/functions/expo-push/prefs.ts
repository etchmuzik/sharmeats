// Notification-preference filtering for the expo-push fan-out (mig 138).
//
// Split out of index.ts so the decision can be unit-tested under `deno test`
// (same pattern as copy.ts and paymob-webhook/verify.ts). index.ts owns the I/O;
// this module owns the rule.

/**
 * Events that IGNORE the `transactional` preference.
 *
 * The settings switch is a real control, but it must not suppress a message
 * whose absence costs someone money, a hand-over, or time standing in the
 * street. Each entry earns its place:
 *
 *  - order_out_for_delivery / order_picked_up / driver_assigned — a courier is
 *    physically approaching; missing it means cold food at an unanswered door.
 *  - order_ready / order_ready_pickup — someone must collect an order NOW.
 *  - order_rejected / order_cancelled / order_cancelled_merchant /
 *    order_cancelled_driver — the awaited thing is NOT coming. Silence is the
 *    worst outcome: they keep waiting.
 *  - payment_failed / order_paid / credit_issued — money moved, or failed to.
 *  - new_offer — a driver's job offer; suppressing it costs them income and
 *    strands the order. Driver-side muting belongs in a driver setting.
 *  - order_placed_merchant — the merchant's only signal to accept an order.
 *  - settlement_paid / settlement_finalized — financial records.
 *  - kyc_approved / kyc_rejected / kyc_submitted — compliance outcomes that
 *    gate someone's ability to work.
 *
 * Deliberately suppressible: order_accepted, order_delivered, new_message,
 * support_reply, support_new_message, low_rating, tier_promoted,
 * referral_rewarded, campaign. Informational or social — muting them still
 * leaves every order completable.
 */
export const ESSENTIAL_EVENTS = new Set<string>([
  'order_out_for_delivery',
  'order_picked_up',
  'driver_assigned',
  'order_ready',
  'order_ready_pickup',
  'order_rejected',
  'order_cancelled',
  'order_cancelled_merchant',
  'order_cancelled_driver',
  'payment_failed',
  'order_paid',
  'credit_issued',
  'new_offer',
  'order_placed_merchant',
  'settlement_paid',
  'settlement_finalized',
  'kyc_approved',
  'kyc_rejected',
  'kyc_submitted',
]);

export interface PrefRow {
  user_id: string;
  transactional: boolean;
}

/**
 * Which of `userIds` should still receive `event`.
 *
 * Rules:
 *  - an ESSENTIAL event goes to everyone, always;
 *  - a missing prefs row means DEFAULT ON (mig 138), so only an explicit
 *    `transactional === false` suppresses;
 *  - `prefRows === null` means the lookup FAILED — fail OPEN and send, because
 *    dropping a wanted order update is worse than one extra notification.
 *    (Marketing is the opposite: it fails closed, in send_push_campaign.)
 */
export function recipientsAfterPrefs(
  event: string,
  userIds: string[],
  prefRows: PrefRow[] | null,
): string[] {
  if (ESSENTIAL_EVENTS.has(event)) return userIds;
  if (prefRows === null) return userIds;
  const optedOut = new Set(prefRows.filter((p) => p.transactional === false).map((p) => p.user_id));
  if (optedOut.size === 0) return userIds;
  return userIds.filter((id) => !optedOut.has(id));
}
