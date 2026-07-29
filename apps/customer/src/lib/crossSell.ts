/**
 * Eligibility rule for the cart's cross-sell rail.
 *
 * WHY THIS IS A MODULE AND NOT AN INLINE FILTER. The rail adds items with a
 * single tap — `addSuggestion` writes straight into the cart with
 * `modifierChoices: []`, skipping the item sheet entirely. Two of the three
 * conditions below exist to keep that one-tap promise honest (an unavailable
 * item can't be sold; a required modifier group needs the modal). The third —
 * prescription — is a safety rule, and safety rules earn their own tests.
 *
 * The Rx case is the sharp one. `RxBadge` renders on the item card and the item
 * sheet; the rail renders NEITHER. So an Rx item in the rail is added with no
 * warning shown anywhere, and the customer discovers the requirement from the
 * driver, at the door, after paying. Worse, the rail sorts by ascending price,
 * and pharmacy Rx items are typically cheap — so the item most likely to be
 * offered first is exactly the one that must never appear.
 *
 * The server already refuses to deliver these (mig 160). This keeps the app
 * from *promising* something the server will then refuse.
 */
import type { MenuItem } from '../data/types';

export function isCrossSellEligible(item: MenuItem): boolean {
  // `requiresPrescription` is optional: the Supabase mapper leaves it undefined
  // when the column is null or false, so most food items never carry the field.
  // Testing truthiness (not `=== true`) keeps the rail full for food while
  // still excluding every item the pharmacy catalog flags.
  if (item.requiresPrescription) return false;
  if (!item.isAvailable) return false;
  return item.modifiers.every((m) => !m.required);
}
