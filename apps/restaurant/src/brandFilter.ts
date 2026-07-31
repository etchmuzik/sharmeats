/**
 * When the multi-brand filter must snap back to "All".
 *
 * The rule is unchanged: a filter that hides a NEW ticket is a bug. What was
 * broken is that the old check was stateless — it asked "does any unaccepted
 * ticket belong to another brand?" on every render, so as long as one brand had
 * an outstanding order the filter bounced back to All the instant anyone
 * selected a brand. The filter was unusable exactly when a busy multi-brand
 * kitchen needs it.
 *
 * The fix is to fire once per TICKET rather than once per render: an unaccepted
 * ticket the operator has already been shown does not get to re-lock the filter.
 * A genuinely new one still does.
 */

/** The only fields this decision reads off a ticket. */
export interface FilterableOrder {
  id: string;
  restaurant_id: string;
}

export interface BrandFilterResetResult {
  /** Snap the filter back to 'all'. */
  reset: boolean;
  /** The ids to carry into the next evaluation (pruned to live tickets). */
  seen: Set<string>;
}

/**
 * @param brandFilter  the currently selected brand, or 'all'
 * @param unaccepted   every ticket still awaiting accept/reject, any brand
 * @param seen         ids returned by the previous call
 */
export function nextBrandFilterReset(
  brandFilter: 'all' | string,
  unaccepted: readonly FilterableOrder[],
  seen: ReadonlySet<string>,
): BrandFilterResetResult {
  const reset =
    brandFilter !== 'all' &&
    unaccepted.some((order) => !seen.has(order.id) && order.restaurant_id !== brandFilter);
  // Prune to the live tickets. An id that has left the unaccepted set cannot
  // come back (accept/reject are one-way), so retaining it would only leak.
  return { reset, seen: new Set(unaccepted.map((order) => order.id)) };
}
