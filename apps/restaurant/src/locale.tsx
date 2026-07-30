import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import {
  localeDirection,
  nextLocale,
  normalizeLocale,
  translate,
  type RestaurantLocale,
  type TranslationKey,
  type TranslationParams,
} from './i18n';

const LOCALE_STORAGE_KEY = 'restaurant:locale';

type LocaleState = {
  locale: RestaurantLocale;
  isRtl: boolean;
  direction: 'ltr' | 'rtl';
  setLocale: (locale: RestaurantLocale) => void;
  toggleLocale: () => void;
  t: (key: TranslationKey, params?: TranslationParams) => string;
};

const LocaleContext = createContext<LocaleState | null>(null);

/**
 * Restaurant locale is an app-local preference. We deliberately avoid
 * I18nManager.forceRTL(): forcing the native process direction requires a full
 * reload and can interrupt an active kitchen ticket. Operational screens opt
 * into the provider's direction immediately, while codes/money stay LTR.
 */
export function LocaleProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<RestaurantLocale>('en');

  useEffect(() => {
    let mounted = true;
    AsyncStorage.getItem(LOCALE_STORAGE_KEY)
      .then((stored) => {
        if (mounted) setLocaleState(normalizeLocale(stored));
      })
      .catch(() => {
        // English remains the fail-safe locale if storage is unavailable.
      });
    return () => {
      mounted = false;
    };
  }, []);

  const setLocale = useCallback((next: RestaurantLocale) => {
    setLocaleState(next);
    AsyncStorage.setItem(LOCALE_STORAGE_KEY, next).catch(() => {
      // The in-memory switch remains useful for this shift even if persistence
      // fails; there is no safe operational reason to block the UI.
    });
  }, []);

  const toggleLocale = useCallback(() => {
    setLocale(nextLocale(locale));
  }, [locale, setLocale]);

  const t = useCallback(
    (key: TranslationKey, params?: TranslationParams) => translate(locale, key, params),
    [locale],
  );
  const direction = localeDirection(locale);

  const value = useMemo<LocaleState>(
    () => ({
      locale,
      isRtl: direction === 'rtl',
      direction,
      setLocale,
      toggleLocale,
      t,
    }),
    [locale, direction, setLocale, toggleLocale, t],
  );

  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

export function useLocale(): LocaleState {
  const context = useContext(LocaleContext);
  if (!context) throw new Error('useLocale must be used within LocaleProvider');
  return context;
}
