import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { detectDeviceLanguage } from '../lib/deviceLocale';

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
    set({ isSignedIn: false, phone: null, favoriteIds: [] });
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

  /** Replace local favorites with the server's list (live-mode sync on start). */
  setFavorites: (ids) => {
    set({ favoriteIds: ids });
    persist(snapshot(get()));
  },
}));
