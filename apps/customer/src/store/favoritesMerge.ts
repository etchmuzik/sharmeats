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
  /** Ids whose DELETE has not landed yet and must be retried. */
  needsRemoval: string[];
  /** The new confirmed-synced set: exactly what the server currently holds. */
  synced: string[];
}

/**
 * Reconcile local, server and pending-removal state.
 *
 * `synced` alone cannot express one case, and it is a real data-loss bug:
 * un-favourite a restaurant the server ALREADY has, while offline. It leaves
 * the local list immediately, the DELETE fails, and it is still in `synced`
 * (because it genuinely was synced) AND still on the server. The next launch
 * merges [...needsUpload, ...server] and puts it straight back — the customer's
 * deliberate removal silently reversed, repeatedly, for as long as they stay
 * offline.
 *
 * `pendingRemovals` is the tombstone that fixes it. Precedence is deliberate:
 *
 *   local presence  >  tombstone  >  server presence
 *
 * so a re-favourite (the newer intent) beats a stale tombstone, and a tombstone
 * beats a server row the delete has not reached yet. A tombstone for something
 * the server no longer has is dropped — the removal landed, and keeping it would
 * block ever re-favouriting that place.
 */
export function mergeFavorites(
  local: string[],
  server: string[],
  synced: string[],
  pendingRemovals: string[] = [],
): FavoritesMergeResult {
  const serverSet = new Set(server);
  const syncedSet = new Set(synced);
  const localSet = new Set(local);

  // A tombstone is live only while the id is absent locally (not re-favourited)
  // and still present on the server (the delete has not landed).
  const removalSet = new Set(
    pendingRemovals.filter((id) => !localSet.has(id) && serverSet.has(id)),
  );

  // Never synced and not on the server => the server has never seen it.
  const needsUpload = local.filter((id) => !serverSet.has(id) && !syncedSet.has(id));

  // De-dupe defensively: a corrupted local list must not double-render a row.
  const merged = Array.from(new Set([...needsUpload, ...server])).filter(
    (id) => !removalSet.has(id),
  );

  return {
    merged,
    needsUpload,
    needsRemoval: Array.from(removalSet),
    // The server list minus what we are about to delete: once the retry lands,
    // this is what the server will hold. Leaving a to-be-deleted id in `synced`
    // would re-arm the exact resurrection this function exists to prevent.
    synced: server.filter((id) => !removalSet.has(id)),
  };
}
