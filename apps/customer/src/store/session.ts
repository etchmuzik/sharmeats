import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { detectDeviceLanguage } from '../lib/deviceLocale';
import { mergeFavorites } from './favoritesMerge';

const STORAGE_KEY = '@sharmeats:session:v1';

export type Locale = 'en' | 'ar' | 'ru' | 'it' | 'de';
export type Currency = 'EGP' | 'EUR' | 'USD' | 'GBP' | 'RUB';

interface SessionState {
  isSignedIn: boolean;
  phone: string | null;
  locale: Locale;
  currency: Currency;
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
  hydrated: boolean;

  hydrate: () => Promise<void>;
  signIn: (phone: string) => void;
  signOut: () => void;
  setLocale: (l: Locale) => void;
  setCurrency: (c: Currency) => void;
  setSelectedAddressId: (id: string | null) => void;
  dismissAllergyNudge: () => void;
  toggleFavorite: (restaurantId: string) => void;
  setFavorites: (ids: string[]) => void;
  markFavoriteSynced: (restaurantId: string) => void;
  mergeFavoritesFromServer: (serverIds: string[]) => string[];
}

type PersistedSession = Pick<
  SessionState,
  | 'isSignedIn'
  | 'phone'
  | 'locale'
  | 'currency'
  | 'selectedAddressId'
  | 'allergyNudgeDismissed'
  | 'favoriteIds'
  | 'syncedFavoriteIds'
>;

function snapshot(s: SessionState): PersistedSession {
  return {
    isSignedIn: s.isSignedIn,
    phone: s.phone,
    locale: s.locale,
    currency: s.currency,
    selectedAddressId: s.selectedAddressId,
    allergyNudgeDismissed: s.allergyNudgeDismissed,
    favoriteIds: s.favoriteIds,
    syncedFavoriteIds: s.syncedFavoriteIds,
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
  // No fake default: a real (esp. anonymous) user has no saved address until
  // they add one. The old mock id 'a-hotel-hilton' never matches a live row, so
  // it made checkout silently unresolvable. null is the honest empty state and
  // lets checkout show an explicit "add address" CTA.
  selectedAddressId: null,
  allergyNudgeDismissed: false,
  favoriteIds: [],
  syncedFavoriteIds: [],
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
    set({ isSignedIn: false, phone: null, favoriteIds: [], syncedFavoriteIds: [] });
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

  setSelectedAddressId: (id) => {
    set({ selectedAddressId: id });
    persist(snapshot(get()));
  },

  dismissAllergyNudge: () => {
    set({ allergyNudgeDismissed: true });
    persist(snapshot(get()));
  },

  toggleFavorite: (restaurantId) => {
    const current = get().favoriteIds;
    const favoriteIds = current.includes(restaurantId)
      ? current.filter((id) => id !== restaurantId)
      : [restaurantId, ...current];
    set({ favoriteIds });
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
    const { favoriteIds, syncedFavoriteIds } = get();
    const { merged, needsUpload, synced } = mergeFavorites(
      favoriteIds,
      serverIds,
      syncedFavoriteIds,
    );
    set({ favoriteIds: merged, syncedFavoriteIds: synced });
    persist(snapshot(get()));
    return needsUpload;
  },
}));
