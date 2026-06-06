import { NativeModules, Platform } from 'react-native';
import type { Locale } from '../store/session';

const SUPPORTED: Locale[] = ['en', 'ar', 'ru', 'it', 'de'];

/**
 * Read the device's preferred language WITHOUT a native dependency.
 *
 * We're tourist-first: the app defaults to English, but if the phone's language
 * is one we support (Arabic for residents, Russian/Italian/German for the big
 * tourist nationalities in Sharm), we honor it on first launch. Uses RN's
 * built-in locale info so this stays pure-JS (hot-reloads, no rebuild).
 */
export function detectDeviceLanguage(): Locale {
  const raw = getRawDeviceLocale();
  const lang = raw.toLowerCase().split(/[-_]/)[0]; // 'ar-EG' -> 'ar'
  const match = SUPPORTED.find((l) => l === lang);
  return match ?? 'en'; // tourist-first default
}

function getRawDeviceLocale(): string {
  try {
    if (Platform.OS === 'ios') {
      const s = NativeModules.SettingsManager?.settings;
      return (
        s?.AppleLocale ||
        (Array.isArray(s?.AppleLanguages) ? s.AppleLanguages[0] : undefined) ||
        'en'
      );
    }
    // Android
    return NativeModules.I18nManager?.localeIdentifier || 'en';
  } catch {
    return 'en';
  }
}
