/**
 * Favorites — local-first with backend sync.
 *
 * The session store (AsyncStorage) is the instant source of truth so the
 * heart toggles with zero latency and works for guests/offline. In live mode
 * every toggle is mirrored to the `favorites` table (owner-only RLS) as a
 * fire-and-forget write, and the server list replaces local state once per
 * app start (syncFavoritesFromServer).
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
      db.user.setFavorite(restaurantId, next).catch(() => {
        // Best-effort sync; local state is already correct and will be
        // reconciled by the next syncFavoritesFromServer().
      });
    }
  };

  return { isFav, toggle };
}

export async function syncFavoritesFromServer(): Promise<void> {
  if (!isBackendLive) return;
  try {
    const ids = await db.user.listFavorites();
    useSession.getState().setFavorites(ids);
  } catch {
    // Offline or not signed in yet — keep the local list.
  }
}
