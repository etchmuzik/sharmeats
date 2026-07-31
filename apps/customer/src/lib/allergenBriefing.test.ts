/**
 * The allergy briefing must reach the kitchen.
 *
 * `orders.aggregate_allergens` exists (mig 003) and the restaurant app renders
 * it as a prominent AllergenBanner — but `place_order` has no allergen
 * parameter, and mig 037 revoked every column-level UPDATE on `orders` except
 * the three rating columns. So the aggregated allergen list the customer picks
 * per item, and is shown back to them on checkout's "what the kitchen sees"
 * card, reached NOBODY on a live order.
 *
 * Until place_order takes the list directly (needs a migration — see FOLLOWUPS),
 * it rides in `p_kitchen_notes`, which the restaurant app and merchant-web both
 * display. These tests pin the two things that make that stop-gap safe: the
 * allergens are never dropped, and a retried checkout does not stack a second
 * briefing onto a note that already carries one.
 */
import { describe, it, expect } from 'vitest';
import { withAllergenBriefing } from './allergenBriefing';

describe('withAllergenBriefing — allergens are never silently dropped', () => {
  it('emits the briefing when there is no other note', () => {
    expect(withAllergenBriefing(undefined, ['nuts', 'shellfish'])).toBe(
      'ALLERGIES: nuts, shellfish',
    );
  });

  it('puts the briefing FIRST, above the customer note', () => {
    expect(withAllergenBriefing('Extra spicy please', ['nuts'])).toBe(
      'ALLERGIES: nuts\nExtra spicy please',
    );
  });

  it('is idempotent — a retried checkout does not stack a second briefing', () => {
    const once = withAllergenBriefing('Extra spicy please', ['nuts']);
    expect(withAllergenBriefing(once ?? undefined, ['nuts'])).toBe(once);
  });

  it('passes a plain note through untouched when there are no allergens', () => {
    expect(withAllergenBriefing('No onions', [])).toBe('No onions');
    expect(withAllergenBriefing('No onions', undefined)).toBe('No onions');
  });

  it('returns null (not an empty string) when there is nothing to say', () => {
    expect(withAllergenBriefing(undefined, undefined)).toBeNull();
    expect(withAllergenBriefing('   ', [])).toBeNull();
  });

  it('uses the stable allergen KEYS, not localized labels', () => {
    // The kitchen reads Arabic/English; the customer may be ordering in Russian.
    // The one thing that must not vary with the app language is the vocabulary.
    expect(withAllergenBriefing(undefined, ['gluten', 'sesame'])).toContain('gluten, sesame');
  });
});
