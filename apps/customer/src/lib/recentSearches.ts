/**
 * Recent searches — search memory, and the rules that keep it useful.
 *
 * Pure list-in/list-out so the rules are testable without a store or a
 * component. The state itself lives in the session store rather than under a
 * storage key of its own, and that is a privacy decision rather than a
 * convenience one: `@sharmeats:session:v1` is already in
 * `IDENTITY_SCOPED_KEYS`, so `transitionIdentity()` purges search history when
 * the device changes hands. A new key would not have been covered unless
 * somebody remembered to add it there.
 *
 * That matters more here than it looks. This catalogue has a pharmacy vertical,
 * so a query can be health information about the person who typed it, and
 * identityTeardown.ts exists because one Sharm Eats install genuinely serves
 * several people in a week — phones get handed to friends, sold, or returned to
 * a hotel desk.
 */

/** Kept short on purpose: this is a glance-and-tap list, not a history log. */
export const MAX_RECENT_SEARCHES = 8;

/**
 * Below this length a query is not remembered. It matches the threshold at
 * which the app actually runs a dish search, so we never store a fragment that
 * could not have produced results in the first place.
 */
export const MIN_RECENT_SEARCH_LENGTH = 2;

/**
 * Trim and collapse whitespace runs, so `"  pizza   margherita "` and
 * `"pizza margherita"` are the same entry rather than two.
 */
export function normalizeSearch(query: string): string {
  return query.trim().replace(/\s+/g, ' ');
}

/**
 * Record a query, most-recent-first.
 *
 * Dedupe is case-INSENSITIVE but keeps the casing just typed: someone who types
 * "Pizza" having previously typed "pizza" ends up with one entry reading
 * "Pizza". Treating them as different would spend a capped list on one word.
 */
export function addRecentSearch(list: readonly string[], query: string): string[] {
  const entry = normalizeSearch(query);
  if (entry.length < MIN_RECENT_SEARCH_LENGTH) return [...list];
  const folded = entry.toLowerCase();
  const rest = list.filter((existing) => normalizeSearch(existing).toLowerCase() !== folded);
  return [entry, ...rest].slice(0, MAX_RECENT_SEARCHES);
}

/** Forget one entry. Matched the same way it was deduped, so the row the user tapped is the row that goes. */
export function removeRecentSearch(list: readonly string[], query: string): string[] {
  const folded = normalizeSearch(query).toLowerCase();
  return list.filter((existing) => normalizeSearch(existing).toLowerCase() !== folded);
}

/**
 * Make a persisted value safe to render.
 *
 * Everything here has been through JSON on a device we do not control, so it is
 * untrusted input: an older build's shape, a half-written file, a restored
 * backup. Anything that is not a usable string is dropped rather than coerced —
 * `String(value)` would put `"[object Object]"` in a tappable row that then
 * searches for it. The cap is re-applied too, so a corrupted list cannot render
 * ten thousand rows.
 */
export function sanitizeRecentSearches(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const value of raw) {
    if (typeof value !== 'string') continue;
    const entry = normalizeSearch(value);
    if (entry.length < MIN_RECENT_SEARCH_LENGTH) continue;
    const folded = entry.toLowerCase();
    if (seen.has(folded)) continue;
    seen.add(folded);
    out.push(entry);
    if (out.length === MAX_RECENT_SEARCHES) break;
  }
  return out;
}
