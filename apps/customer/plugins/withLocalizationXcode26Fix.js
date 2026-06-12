/**
 * Expo config plugin: fix expo-localization compile error under Xcode 26.x.
 *
 * The iOS 26 SDK added new `Calendar.Identifier` cases, so the exhaustive
 * switch in expo-localization's `getUnicodeCalendarIdentifier(calendar:)`
 * (ios/LocalizationModule.swift) no longer compiles on the EAS Xcode 26.2
 * image:
 *
 *   LocalizationModule.swift:93:5: error: switch must be exhaustive
 *
 * expo-localization@16 (SDK 52) predates that SDK and won't be backported, so
 * we patch a `default:` arm into the switch. Unknown/new calendars fall back
 * to "gregory", which is harmless for our use (the app only needs locale +
 * RTL info, not exotic calendar mapping).
 *
 * Same withDangerousMod approach as withFmtConstevalFix: EAS installs fresh
 * node_modules, then runs config plugins during prebuild — so patching the
 * file here reaches the pod compilation. Idempotent (skips if already patched).
 */
const { withDangerousMod } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

const NEEDLE = `    case .iso8601:
      return "iso8601"
    }`;

const REPLACEMENT = `    case .iso8601:
      return "iso8601"
    default:
      // Calendars introduced after this SDK version (Xcode 26 fix).
      return "gregory"
    }`;

module.exports = function withLocalizationXcode26Fix(config) {
  return withDangerousMod(config, [
    'ios',
    (cfg) => {
      const file = path.join(
        cfg.modRequest.projectRoot,
        'node_modules',
        'expo-localization',
        'ios',
        'LocalizationModule.swift',
      );
      if (!fs.existsSync(file)) {
        console.warn('[withLocalizationXcode26Fix] LocalizationModule.swift not found — skipping');
        return cfg;
      }
      const contents = fs.readFileSync(file, 'utf8');
      if (contents.includes('Xcode 26 fix')) {
        return cfg; // already patched
      }
      if (!contents.includes(NEEDLE)) {
        console.warn(
          '[withLocalizationXcode26Fix] expected switch shape not found — expo-localization may have changed; skipping',
        );
        return cfg;
      }
      fs.writeFileSync(file, contents.replace(NEEDLE, REPLACEMENT));
      console.log('[withLocalizationXcode26Fix] patched LocalizationModule.swift');
      return cfg;
    },
  ]);
};
