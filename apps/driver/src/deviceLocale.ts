/**
 * The phone's own language, used to pick a starting locale on first launch.
 *
 * The app hardcoded 'en' as its initial locale and only ever changed it when the
 * driver found the language toggle — in a market where the drivers are Arabic
 * speakers. A driver whose phone is set to Arabic should never have to hunt for
 * a control in a language they don't read.
 *
 * Read from React Native's own constants rather than expo-localization: that is
 * a native module, and this fix has to ship over the air. `Intl` is tried first
 * because Hermes exposes it on both platforms; the NativeModules constants are
 * the long-standing fallback (`AppleLocale`/`AppleLanguages` on iOS,
 * `I18nManager.localeIdentifier` on Android). Every read is defensive — a
 * missing constant must degrade to "unknown", never throw during boot.
 */
import { NativeModules, Platform } from 'react-native';
import { matchSupportedLocale, type Locale } from './i18n';

function fromIntl(): string | null {
  try {
    return Intl.DateTimeFormat().resolvedOptions().locale ?? null;
  } catch {
    return null;
  }
}

function fromNativeModules(): string | null {
  try {
    if (Platform.OS === 'ios') {
      const settings = (
        NativeModules as { SettingsManager?: { settings?: Record<string, unknown> } }
      ).SettingsManager?.settings;
      const languages = settings?.AppleLanguages;
      if (Array.isArray(languages) && typeof languages[0] === 'string') return languages[0];
      if (typeof settings?.AppleLocale === 'string') return settings.AppleLocale;
      return null;
    }
    const identifier = (
      NativeModules as { I18nManager?: { localeIdentifier?: unknown } }
    ).I18nManager?.localeIdentifier;
    return typeof identifier === 'string' ? identifier : null;
  } catch {
    return null;
  }
}

/** The supported locale the device asks for, or null when it asks for none we ship. */
export function deviceLocale(): Locale | null {
  return matchSupportedLocale(fromIntl()) ?? matchSupportedLocale(fromNativeModules());
}
