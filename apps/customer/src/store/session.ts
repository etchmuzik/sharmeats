import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';

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
  hydrated: boolean;

  hydrate: () => Promise<void>;
  signIn: (phone: string) => void;
  signOut: () => void;
  setLocale: (l: Locale) => void;
  setCurrency: (c: Currency) => void;
  setSelectedAddressId: (id: string | null) => void;
  dismissAllergyNudge: () => void;
}

function persist(state: Omit<SessionState, 'hydrated' | 'hydrate' | 'signIn' | 'signOut' | 'setLocale' | 'setCurrency' | 'setSelectedAddressId' | 'dismissAllergyNudge'>) {
  AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(state)).catch(() => {});
}

export const useSession = create<SessionState>((set, get) => ({
  isSignedIn: false,
  phone: null,
  locale: 'ar',
  currency: 'EGP',
  selectedAddressId: 'a-default-street',
  allergyNudgeDismissed: false,
  hydrated: false,

  hydrate: async () => {
    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<SessionState>;
        set({
          isSignedIn: parsed.isSignedIn ?? false,
          phone: parsed.phone ?? null,
          locale: (parsed.locale as Locale) ?? 'ar',
          currency: (parsed.currency as Currency) ?? 'EGP',
          selectedAddressId: parsed.selectedAddressId ?? 'a-default-street',
          allergyNudgeDismissed: parsed.allergyNudgeDismissed ?? false,
          hydrated: true,
        });
        return;
      }
    } catch {
      /* ignore */
    }
    set({ hydrated: true });
  },

  signIn: (phone) => {
    set({ isSignedIn: true, phone });
    const s = get();
    persist({
      isSignedIn: true,
      phone,
      locale: s.locale,
      currency: s.currency,
      selectedAddressId: s.selectedAddressId,
      allergyNudgeDismissed: s.allergyNudgeDismissed,
    });
  },

  signOut: () => {
    set({ isSignedIn: false, phone: null });
    AsyncStorage.removeItem(STORAGE_KEY).catch(() => {});
  },

  setLocale: (locale) => {
    set({ locale });
    const s = get();
    persist({
      isSignedIn: s.isSignedIn,
      phone: s.phone,
      locale,
      currency: s.currency,
      selectedAddressId: s.selectedAddressId,
      allergyNudgeDismissed: s.allergyNudgeDismissed,
    });
  },

  setCurrency: (currency) => {
    set({ currency });
    const s = get();
    persist({
      isSignedIn: s.isSignedIn,
      phone: s.phone,
      locale: s.locale,
      currency,
      selectedAddressId: s.selectedAddressId,
      allergyNudgeDismissed: s.allergyNudgeDismissed,
    });
  },

  setSelectedAddressId: (id) => {
    set({ selectedAddressId: id });
    const s = get();
    persist({
      isSignedIn: s.isSignedIn,
      phone: s.phone,
      locale: s.locale,
      currency: s.currency,
      selectedAddressId: id,
      allergyNudgeDismissed: s.allergyNudgeDismissed,
    });
  },

  dismissAllergyNudge: () => {
    set({ allergyNudgeDismissed: true });
    const s = get();
    persist({
      isSignedIn: s.isSignedIn,
      phone: s.phone,
      locale: s.locale,
      currency: s.currency,
      selectedAddressId: s.selectedAddressId,
      allergyNudgeDismissed: true,
    });
  },
}));
