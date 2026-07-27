/**
 * The guest-favourite merge rule, extracted so it can be tested directly.
 *
 * Called on app start and immediately after OTP verification. The problem it
 * solves: the old sync replaced local favourites with the server's list, which
 * discarded a guest's saved restaurants whenever the server had never seen them
 * — most visibly when someone saves a few places as a guest and then signs in
 * with a phone that already has an account, because that swaps auth.uid() and
 * the server list belongs to a different history.
 *
 * The naive fix (union the two lists) is wrong: a favourite removed on another
 * device is also absent from the server list, and would be resurrected on every
 * launch. `synced` — the ids we have CONFIRMED the server stored — is what
 * distinguishes "deliberately removed" from "never uploaded".
 */
export interface FavoritesMergeResult {
  /** The list to show the user. */
  merged: string[];
  /** Ids that must still be uploaded (the rescued guest picks). */
  needsUpload: string[];
  /** The new confirmed-synced set: exactly what the server currently holds. */
  synced: string[];
}

export function mergeFavorites(
  local: string[],
  server: string[],
  synced: string[],
): FavoritesMergeResult {
  const serverSet = new Set(server);
  const syncedSet = new Set(synced);
  // Never synced and not on the server => the server has never seen it.
  const needsUpload = local.filter((id) => !serverSet.has(id) && !syncedSet.has(id));
  // De-dupe defensively: a corrupted local list must not double-render a row.
  const merged = Array.from(new Set([...needsUpload, ...server]));
  return { merged, needsUpload, synced: server };
}
