/**
 * Get the allergy briefing to the kitchen.
 *
 * FOOD SAFETY. `orders.aggregate_allergens` exists (mig 003) and the restaurant
 * app renders it as a prominent AllergenBanner — but `place_order` has NO
 * allergen parameter, and mig 037 revoked every column-level UPDATE on `orders`
 * except the three rating columns. So the allergen list the customer selected on
 * each item, aggregated and shown back to them on checkout's "what the kitchen
 * sees" card, reached exactly nobody: the column is null on every live order and
 * the banner never renders. The customer is told the kitchen has been briefed;
 * it has not.
 *
 * `p_kitchen_notes` IS threaded through to a column the kitchen actually reads
 * (restaurant app order detail + merchant-web order card), so until place_order
 * takes a `p_allergens` argument (see FOLLOWUPS — that needs a migration, which
 * the customer surface cannot write) the briefing rides along with the note
 * rather than being dropped on the floor.
 *
 * Pure on purpose: this is the one piece of checkout whose failure mode is
 * somebody eating an allergen, so it is testable without a store or a network.
 */

/** Prefix the kitchen note carries when it is standing in for the allergen column. */
export const ALLERGEN_NOTE_PREFIX = 'ALLERGIES:';

/**
 * Fold the aggregated allergen list into the kitchen note.
 *
 * Allergens are emitted as their stable KEYS, not localized labels: the kitchen
 * reads Arabic/English and the customer may be ordering in Russian, so the one
 * thing that must not vary is the vocabulary.
 *
 * Idempotent — a retry of the same checkout produces the same string rather than
 * stacking a second briefing onto a note that already has one.
 */
export function withAllergenBriefing(
  notes: string | undefined,
  allergens: readonly string[] | undefined,
): string | null {
  const note = notes?.trim() ?? '';
  if (!allergens || allergens.length === 0) return note || null;
  if (note.startsWith(ALLERGEN_NOTE_PREFIX)) return note;
  const briefing = `${ALLERGEN_NOTE_PREFIX} ${allergens.join(', ')}`;
  return note ? `${briefing}\n${note}` : briefing;
}
