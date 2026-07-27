/**
 * Favorites — local-first with backend sync.
 *
 * The session store (AsyncStorage) is the instant source of truth so the heart
 * toggles with zero latency and works for guests/offline. In live mode every
 * toggle is mirrored to the `favorites` table (owner-only RLS), and on app
 * start the local and server lists are MERGED (not overwritten).
 *
 * Why merge rather than replace: the old sync called setFavorites(serverIds),
 * which discarded any favourite the server had not seen. That silently lost
 * data in two real cases — a guest who saved restaurants and then signed in
 * with a phone that already had an account (a different auth.uid(), so the
 * server list is someone else's history), and any toggle whose fire-and-forget
 * mirror write failed offline.
 *
 * Why NOT a blind union: a favourite the user deliberately removed on another
 * device is absent from the server list, and looks identical to "never synced"
 * unless we track what the server has actually confirmed. syncedFavoriteIds is
 * that record, so removals stick and only genuinely-unsynced picks are kept.
 */
import { useSession } from '../store/session';
import { db, isBackendLive } from '../data';
import { track } from './analytics';

export function useFavorite(restaurantId: string) {
  const isFav = useSession((s) => s.favoriteIds.includes(restaurantId));

  const toggle = () => {
    const next = !isFav;
    useSession.getState().toggleFavorite(restaurantId);
    track('favorite_toggled', { restaurantId, on: next });
    if (isBackendLive) {
      db.user
        .setFavorite(restaurantId, next)
        .then(() => {
          // Only now do we know the server has it. Un-favouriting drops the id
          // from both lists via toggleFavorite, so nothing to mark on removal.
          if (next) useSession.getState().markFavoriteSynced(restaurantId);
        })
        .catch(() => {
          // Best-effort: local state is already correct, and because this id is
          // NOT marked synced, the next merge will re-upload it instead of
          // dropping it.
        });
    }
  };

  return { isFav, toggle };
}

/**
 * Save/unsave a single dish. Same local-first + confirmed-sync model as
 * useFavorite, so a guest's saved dishes survive sign-in (see mergeFavorites).
 * restaurantId is required because the row denormalises it and the composite FK
 * rejects a value that disagrees with the item.
 */
export function useFavoriteItem(menuItemId: string, restaurantId: string) {
  const isFav = useSession((s) => s.favoriteItemIds.includes(menuItemId));

  const toggle = () => {
    const next = !isFav;
    useSession.getState().toggleFavoriteItem(menuItemId, restaurantId);
    track('favorite_toggled', { menuItemId, restaurantId, on: next, kind: 'item' });
    if (isBackendLive) {
      db.user
        .setFavoriteItem(menuItemId, restaurantId, next)
        .then(() => {
          if (next) useSession.getState().markFavoriteItemSynced(menuItemId);
        })
        .catch(() => {
          // Not marked synced => the next merge re-uploads it rather than
          // dropping it.
        });
    }
  };

  return { isFav, toggle };
}

/**
 * Reconcile local and server favourites on app start, then push up anything the
 * server has never seen. Safe to call on every launch and after sign-in.
 * Covers both restaurants and dishes.
 */
export async function syncFavoritesFromServer(): Promise<void> {
  if (!isBackendLive) return;

  // Restaurants and dishes are reconciled independently: one failing (or the
  // dish table not existing on an older backend) must not abandon the other.
  try {
    const serverIds = await db.user.listFavorites();
    const { needsUpload, needsRemoval } = useSession
      .getState()
      .mergeFavoritesFromServer(serverIds);
    // Upload the rescued guest picks. Each is marked synced only on success, so
    // a failure here leaves it queued for the next launch rather than lost.
    await Promise.all(
      needsUpload.map((id) =>
        db.user
          .setFavorite(id, true)
          .then(() => useSession.getState().markFavoriteSynced(id))
          .catch(() => {}),
      ),
    );
    // Replay removals whose DELETE never landed. Without this the tombstone
    // only hides the row locally and the server copy lives forever, so a
    // reinstall would bring every "removed" favourite back.
    await Promise.all(
      needsRemoval.map((id) =>
        db.user
          .setFavorite(id, false)
          .then(() => useSession.getState().clearPendingFavoriteRemoval(id))
          // Still offline: keep the tombstone and retry next launch.
          .catch(() => {}),
      ),
    );
  } catch {
    // Offline or not signed in yet — keep the local list untouched.
  }

  try {
    const serverItemIds = await db.user.listFavoriteItemIds();
    const needsUpload = useSession.getState().mergeFavoriteItemsFromServer(serverItemIds);
    await Promise.all(
      needsUpload.map((id) => {
        const restaurantId = useSession.getState().favoriteItemRestaurantIds[id];
        // Without the restaurant id we cannot satisfy the composite FK, so skip
        // rather than send a write we know will fail. The id stays unsynced and
        // is retried once the user opens that item again.
        if (!restaurantId) return Promise.resolve();
        return db.user
          .setFavoriteItem(id, restaurantId, true)
          .then(() => useSession.getState().markFavoriteItemSynced(id))
          .catch(() => {});
      }),
    );
  } catch {
    // Offline — keep the local list untouched.
  }
}
