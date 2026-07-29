/**
 * Dietary-flag index logic, shared by the mock and Supabase adapters so both
 * answer "which restaurants can satisfy these filters" identically.
 *
 * Semantics preserved from the code this replaced: a restaurant qualifies when
 * the UNION of flags across its available items covers every required flag. That
 * is deliberately per-restaurant rather than per-item — the browse list filters
 * restaurants, and a place with a vegetarian dish AND a separate gluten-free dish
 * can serve someone filtering for both.
 */

/** Just the columns the index needs; both adapters can produce this. */
export interface FlaggedItemRow {
  restaurantId: string;
  flags: readonly string[];
}

/**
 * Restaurant ids whose available items collectively carry ALL of `required`.
 *
 * `required` empty returns an empty set, and callers treat that as "no filter" —
 * returning every id instead would be indistinguishable from "everything
 * matches" at the call site and one refactor away from a silent filter bypass.
 */
export function restaurantsWithAllFlags(
  rows: readonly FlaggedItemRow[],
  required: readonly string[],
): Set<string> {
  if (required.length === 0) return new Set();

  const seen = new Map<string, Set<string>>();
  for (const row of rows) {
    const acc = seen.get(row.restaurantId) ?? new Set<string>();
    for (const flag of row.flags) {
      // Only track flags we were asked about; a restaurant's other flags cannot
      // affect the answer and would just grow the set.
      if (required.includes(flag)) acc.add(flag);
    }
    seen.set(row.restaurantId, acc);
  }

  const qualifying = new Set<string>();
  for (const [restaurantId, flags] of seen) {
    if (required.every((f) => flags.has(f))) qualifying.add(restaurantId);
  }
  return qualifying;
}
