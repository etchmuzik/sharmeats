import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  createContext,
  type PropsWithChildren,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  DRIVER_LOCALE_STORAGE_KEY,
  isSupportedLocale,
  localeDirection,
  localizedOperationalError,
  translate,
  type Locale,
  type OperationalFailure,
  type TranslationKey,
} from './i18n';

type Translate = (
  key: TranslationKey,
  params?: Record<string, string | number>,
) => string;

type I18nValue = {
  locale: Locale;
  isRTL: boolean;
  direction: ReturnType<typeof localeDirection>;
  setLocale: (locale: Locale) => Promise<void>;
  toggleLocale: () => Promise<void>;
  errorMessage: (failure: OperationalFailure, error: unknown) => string;
  t: Translate;
};

const I18nContext = createContext<I18nValue | null>(null);

export function LanguageProvider({ children }: PropsWithChildren) {
  const [locale, setLocaleState] = useState<Locale>('en');
  const userSelectedRef = useRef(false);

  useEffect(() => {
    let active = true;
    AsyncStorage.getItem(DRIVER_LOCALE_STORAGE_KEY)
      .then((saved) => {
        if (active && !userSelectedRef.current && isSupportedLocale(saved)) {
          setLocaleState(saved);
        }
      })
      .catch(() => {
        // Language persistence is a convenience; it must never block a shift.
      });
    return () => {
      active = false;
    };
  }, []);

  const setLocale = useCallback(async (next: Locale) => {
    userSelectedRef.current = true;
    setLocaleState(next);
    try {
      await AsyncStorage.setItem(DRIVER_LOCALE_STORAGE_KEY, next);
    } catch {
      // Keep the in-memory choice even if device storage is unavailable.
    }
  }, []);

  const toggleLocale = useCallback(
    () => setLocale(locale === 'en' ? 'ar' : 'en'),
    [locale, setLocale],
  );

  const value = useMemo<I18nValue>(
    () => ({
      locale,
      isRTL: locale === 'ar',
      direction: localeDirection(locale),
      setLocale,
      toggleLocale,
      errorMessage: (failure, error) =>
        localizedOperationalError(locale, failure, error),
      t: (key, params) => translate(locale, key, params),
    }),
    [locale, setLocale, toggleLocale],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
  const value = useContext(I18nContext);
  if (!value) throw new Error('useI18n must be used inside LanguageProvider');
  return value;
}
