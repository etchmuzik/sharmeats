import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { detectDeviceLanguage } from '../lib/deviceLocale';
import { mergeFavorites } from './favoritesMerge';
import {
  addRecentSearch,
  removeRecentSearch,
  sanitizeRecentSearches,
} from '../lib/recentSearches';
import type { ThemeMode } from '../theme';

const STORAGE_KEY = '@sharmeats:session:v1';

export type Locale = 'en' | 'ar' | 'ru' | 'it' | 'de';
export type Currency = 'EGP' | 'EUR' | 'USD' | 'GBP' | 'RUB';
export type { ThemeMode };

interface SessionState {
  isSignedIn: boolean;
  phone: string | null;
  locale: Locale;
  currency: Currency;
  /**
   * Light/dark preference. Defaults to `system` so the app matches the phone
   * without anyone having to find the setting.
   */
  themeMode: ThemeMode;
  selectedAddressId: string | null;
  allergyNudgeDismissed: boolean;
  /** Saved restaurant ids. Local-first; synced with the backend in live mode. */
  favoriteIds: string[];
  /**
   * Favourite ids we have CONFIRMED are stored server-side (the mirror write
   * returned OK). Anything in favoriteIds but not here was never persisted for
   * this account — it is either a guest pick made before sign-in, or a mirror
   * write that failed offline.
   *
   * This distinction is what makes the merge safe. A blind union of local and
   * server would resurrect restaurants the user deliberately UN-favourited on
   * another device, because a removal looks identical to "never synced" if you
   * only compare the two lists. Tracking confirmation lets us keep server
   * removals while rescuing genuinely-unsynced picks.
   */
  syncedFavoriteIds: string[];
  /**
   * Favourites the user removed while the DELETE could not reach the server.
   * Without this, un-favouriting a SYNCED restaurant offline is silently undone
   * by the next merge: it is still on the server and still in syncedFavoriteIds,
   * so it looks exactly like a favourite that was never removed. Cleared once
   * the server confirms it is gone.
   */
  pendingFavoriteRemovals: string[];
  /**
   * Whether we have already shown OUR push primer. Distinct from the OS
   * permission state: once someone declines the primer we stop asking, even
   * though the OS would still show its dialog. Nagging is how an app trains
   * people to refuse.
   */
  pushPrimerAsked: boolean;
  /** Saved individual dishes (mig 139). Same local-first + merge model. */
  favoriteItemIds: string[];
  syncedFavoriteItemIds: string[];
  /**
   * menuItemId -> restaurantId for locally-saved dishes. Needed because the
   * server row denormalises restaurant_id behind a composite FK, so an unsynced
   * guest save cannot be uploaded later without knowing which restaurant it
   * came from. Kept as a plain map so it survives AsyncStorage round-tripping.
   */
  favoriteItemRestaurantIds: Record<string, string>;
  /**
   * Queries the user has actually committed to — submitted, or followed
   * through to a result. Never a keystroke prefix (see browse.tsx).
   *
   * Lives HERE, in the identity-scoped blob, rather than under a key of its
   * own, so `transitionIdentity()` already erases it when the device changes
   * hands. Search history is among the most revealing data this app holds: the
   * catalogue includes a pharmacy vertical, so a query can be health
   * information about whoever typed it.
   */
  recentSearches: string[];
  hydrated: boolean;

  hydrate: () => Promise<void>;
  signIn: (phone: string) => void;
  signOut: () => void;
  setLocale: (l: Locale) => void;
  setCurrency: (c: Currency) => void;
  setThemeMode: (m: ThemeMode) => void;
  setSelectedAddressId: (id: string | null) => void;
  dismissAllergyNudge: () => void;
  toggleFavorite: (restaurantId: string) => void;
  setFavorites: (ids: string[]) => void;
  markFavoriteSynced: (restaurantId: string) => void;
  mergeFavoritesFromServer: (serverIds: string[]) => { needsUpload: string[]; needsRemoval: string[] };
  clearPendingFavoriteRemoval: (restaurantId: string) => void;
  markPushPrimerAsked: () => void;
  toggleFavoriteItem: (menuItemId: string, restaurantId: string) => void;
  markFavoriteItemSynced: (menuItemId: string) => void;
  mergeFavoriteItemsFromServer: (serverIds: string[]) => string[];
  rememberSearch: (query: string) => void;
  forgetSearch: (query: string) => void;
  clearRecentSearches: () => void;
}

type PersistedSession = Pick<
  SessionState,
  | 'isSignedIn'
  | 'phone'
  | 'locale'
  | 'currency'
  | 'themeMode'
  | 'selectedAddressId'
  | 'allergyNudgeDismissed'
  | 'favoriteIds'
  | 'syncedFavoriteIds'
  | 'pendingFavoriteRemovals'
  | 'pushPrimerAsked'
  | 'favoriteItemIds'
  | 'syncedFavoriteItemIds'
  | 'favoriteItemRestaurantIds'
  | 'recentSearches'
>;

function snapshot(s: SessionState): PersistedSession {
  return {
    isSignedIn: s.isSignedIn,
    phone: s.phone,
    locale: s.locale,
    currency: s.currency,
    themeMode: s.themeMode,
    selectedAddressId: s.selectedAddressId,
    allergyNudgeDismissed: s.allergyNudgeDismissed,
    favoriteIds: s.favoriteIds,
    syncedFavoriteIds: s.syncedFavoriteIds,
    pendingFavoriteRemovals: s.pendingFavoriteRemovals,
    pushPrimerAsked: s.pushPrimerAsked,
    favoriteItemIds: s.favoriteItemIds,
    syncedFavoriteItemIds: s.syncedFavoriteItemIds,
    favoriteItemRestaurantIds: s.favoriteItemRestaurantIds,
    recentSearches: s.recentSearches,
  };
}

function persist(state: PersistedSession) {
  AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(state)).catch(() => {});
}

export const useSession = create<SessionState>((set, get) => ({
  isSignedIn: false,
  phone: null,
  // Tourist-first: default English. Overridden by device language on first
  // launch (see hydrate) and by the user's explicit choice thereafter.
  locale: 'en',
  currency: 'EGP',
  themeMode: 'system',
  // No fake default: a real (esp. anonymous) user has no saved address until
  // they add one. The old mock id 'a-hotel-hilton' never matches a live row, so
  // it made checkout silently unresolvable. null is the honest empty state and
  // lets checkout show an explicit "add address" CTA.
  selectedAddressId: null,
  allergyNudgeDismissed: false,
  favoriteIds: [],
  syncedFavoriteIds: [],
  pendingFavoriteRemovals: [],
  pushPrimerAsked: false,
  favoriteItemIds: [],
  syncedFavoriteItemIds: [],
  favoriteItemRestaurantIds: {},
  recentSearches: [],
  hydrated: false,

  hydrate: async () => {
    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<SessionState>;
        set({
          isSignedIn: parsed.isSignedIn ?? false,
          phone: parsed.phone ?? null,
          locale: (parsed.locale as Locale) ?? detectDeviceLanguage(),
          currency: (parsed.currency as Currency) ?? 'EGP',
          // A session persisted before dark mode existed has no themeMode.
          // 'system' is the right upgrade: it matches the phone rather than
          // pinning existing users to light forever.
          themeMode: (parsed.themeMode as ThemeMode) ?? 'system',
          selectedAddressId: parsed.selectedAddressId ?? null,
          allergyNudgeDismissed: parsed.allergyNudgeDismissed ?? false,
          favoriteIds: Array.isArray(parsed.favoriteIds) ? parsed.favoriteIds : [],
          // Upgrade path: a session persisted by an older build has no
          // syncedFavoriteIds. Treating those favourites as ALREADY SYNCED is
          // the conservative read — the old build mirrored every toggle to the
          // server, so assuming "unsynced" would re-upload favourites the user
          // may since have removed elsewhere. Worst case we skip rescuing one
          // stale offline toggle; the alternative resurrects deleted data.
          syncedFavoriteIds: Array.isArray(parsed.syncedFavoriteIds)
            ? parsed.syncedFavoriteIds
            : Array.isArray(parsed.favoriteIds)
              ? parsed.favoriteIds
              : [],
          // Must survive a relaunch: an offline removal is most likely to be
          // retried on the NEXT launch, which is precisely when the app has
          // been restarted and in-memory state is gone.
          pendingFavoriteRemovals: Array.isArray(parsed.pendingFavoriteRemovals)
            ? parsed.pendingFavoriteRemovals
            : [],
          pushPrimerAsked: parsed.pushPrimerAsked === true,
          favoriteItemIds: Array.isArray(parsed.favoriteItemIds) ? parsed.favoriteItemIds : [],
          // Item favourites are NEW in this build, so there is no older state to
          // be conservative about: anything present was saved by this build and
          // its synced list is authoritative.
          syncedFavoriteItemIds: Array.isArray(parsed.syncedFavoriteItemIds)
            ? parsed.syncedFavoriteItemIds
            : [],
          favoriteItemRestaurantIds:
            parsed.favoriteItemRestaurantIds && typeof parsed.favoriteItemRestaurantIds === 'object'
              ? parsed.favoriteItemRestaurantIds
              : {},
          // Sanitised rather than trusted: these strings are rendered into
          // tappable rows, and the blob may come from an older build, a
          // half-written file, or a restored backup.
          recentSearches: sanitizeRecentSearches(parsed.recentSearches),
          hydrated: true,
        });
        return;
      }
    } catch {
      /* ignore */
    }
    // No stored session (first launch): pick the device language, tourist-first.
    set({ locale: detectDeviceLanguage(), hydrated: true });
  },

  signIn: (phone) => {
    set({ isSignedIn: true, phone });
    persist(snapshot(get()));
  },

  signOut: () => {
    // syncedFavoriteIds must clear with favoriteIds: a stale "already synced"
    // list would make the NEXT user's guest picks look uploaded, so the merge
    // would drop them instead of rescuing them.
    set({
      isSignedIn: false,
      phone: null,
      favoriteIds: [],
      syncedFavoriteIds: [],
      pendingFavoriteRemovals: [],
      favoriteItemIds: [],
      syncedFavoriteItemIds: [],
      favoriteItemRestaurantIds: {},
      // In-memory clearing matters as much as the key removal below: a browse
      // screen mounted at sign-out would keep rendering the previous person's
      // search history, and the next write would persist it straight back.
      recentSearches: [],
    });
    AsyncStorage.removeItem(STORAGE_KEY).catch(() => {});
  },

  setLocale: (locale) => {
    set({ locale });
    persist(snapshot(get()));
  },

  setCurrency: (currency) => {
    set({ currency });
    persist(snapshot(get()));
  },

  setThemeMode: (themeMode) => {
    set({ themeMode });
    persist(snapshot(get()));
  },

  setSelectedAddressId: (id) => {
    set({ selectedAddressId: id });
    persist(snapshot(get()));
  },

  dismissAllergyNudge: () => {
    set({ allergyNudgeDismissed: true });
    persist(snapshot(get()));
  },

  toggleFavorite: (restaurantId) => {
    const { favoriteIds: current, syncedFavoriteIds, pendingFavoriteRemovals } = get();
    const removing = current.includes(restaurantId);
    const favoriteIds = removing
      ? current.filter((id) => id !== restaurantId)
      : [restaurantId, ...current];

    // Record a tombstone only when removing something the server is KNOWN to
    // hold. An unsynced pick has nothing to delete server-side, so a tombstone
    // would be noise. Re-favouriting always clears any tombstone: that tap is
    // the newer intent and must win.
    const pending = removing
      ? syncedFavoriteIds.includes(restaurantId)
        ? Array.from(new Set([...pendingFavoriteRemovals, restaurantId]))
        : pendingFavoriteRemovals
      : pendingFavoriteRemovals.filter((id) => id !== restaurantId);

    set({ favoriteIds, pendingFavoriteRemovals: pending });
    persist(snapshot(get()));
  },

  /**
   * Replace local favorites with the server's list. Used by mock mode and by
   * an explicit reset; live-mode start-up sync uses mergeFavoritesFromServer
   * so a guest's unsynced picks are not silently discarded.
   */
  setFavorites: (ids) => {
    set({ favoriteIds: ids, syncedFavoriteIds: ids });
    persist(snapshot(get()));
  },

  /** Record that a favourite is confirmed stored server-side for this account. */
  markFavoriteSynced: (restaurantId) => {
    const synced = get().syncedFavoriteIds;
    if (synced.includes(restaurantId)) return;
    set({ syncedFavoriteIds: [...synced, restaurantId] });
    persist(snapshot(get()));
  },

  /**
   * Reconcile local favourites with the server's list on app start, returning
   * the ids that still need uploading.
   *
   * The rule: the server is authoritative for anything we know it has seen, and
   * local wins only for picks it has never seen.
   *
   *   - in server list            -> keep (authoritative)
   *   - local, never synced       -> KEEP and report for upload (the guest's
   *                                  picks, or a toggle made offline)
   *   - local, synced, now absent -> DROP (a deliberate removal, possibly from
   *                                  another device — resurrecting it would be
   *                                  the bug this function exists to avoid)
   */
  mergeFavoritesFromServer: (serverIds) => {
    const { favoriteIds, syncedFavoriteIds, pendingFavoriteRemovals } = get();
    const { merged, needsUpload, needsRemoval, synced } = mergeFavorites(
      favoriteIds,
      serverIds,
      syncedFavoriteIds,
      pendingFavoriteRemovals,
    );
    // Keep only the tombstones still worth retrying. Anything the server has
    // already dropped is done; anything re-favourited locally was superseded.
    set({ favoriteIds: merged, syncedFavoriteIds: synced, pendingFavoriteRemovals: needsRemoval });
    persist(snapshot(get()));
    return { needsUpload, needsRemoval };
  },

  markPushPrimerAsked: () => {
    if (get().pushPrimerAsked) return;
    set({ pushPrimerAsked: true });
    persist(snapshot(get()));
  },

  clearPendingFavoriteRemoval: (restaurantId) => {
    const pending = get().pendingFavoriteRemovals;
    if (!pending.includes(restaurantId)) return;
    set({ pendingFavoriteRemovals: pending.filter((id) => id !== restaurantId) });
    persist(snapshot(get()));
  },

  toggleFavoriteItem: (menuItemId, restaurantId) => {
    const current = get().favoriteItemIds;
    const on = !current.includes(menuItemId);
    const favoriteItemIds = on
      ? [menuItemId, ...current]
      : current.filter((id) => id !== menuItemId);
    // Remember where the dish came from while it is saved; drop the mapping on
    // un-save so the map cannot grow without bound.
    const map = { ...get().favoriteItemRestaurantIds };
    if (on) map[menuItemId] = restaurantId;
    else delete map[menuItemId];
    set({ favoriteItemIds, favoriteItemRestaurantIds: map });
    persist(snapshot(get()));
  },

  markFavoriteItemSynced: (menuItemId) => {
    const synced = get().syncedFavoriteItemIds;
    if (synced.includes(menuItemId)) return;
    set({ syncedFavoriteItemIds: [...synced, menuItemId] });
    persist(snapshot(get()));
  },

  /** Same merge rule as restaurants — see mergeFavorites for why not a union. */
  mergeFavoriteItemsFromServer: (serverIds) => {
    const { favoriteItemIds, syncedFavoriteItemIds } = get();
    const { merged, needsUpload, synced } = mergeFavorites(
      favoriteItemIds,
      serverIds,
      syncedFavoriteItemIds,
    );
    set({ favoriteItemIds: merged, syncedFavoriteItemIds: synced });
    persist(snapshot(get()));
    return needsUpload;
  },

  /**
   * Called only for a query the user COMMITTED to — submitted from the
   * keyboard, or followed through to a result. Never on a keystroke: recording
   * every debounced prefix would fill the list with "piz" and "pizz" and evict
   * the searches worth keeping.
   */
  rememberSearch: (query) => {
    const recentSearches = addRecentSearch(get().recentSearches, query);
    // addRecentSearch returns a copy even when nothing changed (too short, or
    // already newest), so compare before writing to avoid a pointless render
    // and AsyncStorage write on every submit of the same term.
    const current = get().recentSearches;
    if (recentSearches.length === current.length && recentSearches.every((q, i) => q === current[i]))
      return;
    set({ recentSearches });
    persist(snapshot(get()));
  },

  forgetSearch: (query) => {
    set({ recentSearches: removeRecentSearch(get().recentSearches, query) });
    persist(snapshot(get()));
  },

  clearRecentSearches: () => {
    set({ recentSearches: [] });
    persist(snapshot(get()));
  },
}));
