// Expo reads this in preference to app.json when both exist. app.json remains
// the single source of truth for everything static; this file adds only what
// cannot be expressed there.
//
// WHY IT EXISTS: Android push needs google-services.json present at build time.
// That file is not in this repository and should not be — the repo is public,
// and while Google does not class google-services.json as a secret, publishing
// the project number and API key invites nuisance abuse of the FCM quota for no
// benefit. It is supplied instead as a file-type EAS environment variable,
// GOOGLE_SERVICES_JSON, which EAS materialises on the build worker and exposes
// to the build as a path.
//
// WHY IT IS CONDITIONAL, and this is the important part: setting
// googleServicesFile to a path that does not exist fails the Android build
// outright. Until the file is uploaded, omitting the key entirely is the only
// safe state — it leaves the resolved config byte-identical to what app.json
// alone produced, which was verified by diffing `expo config --type public`
// before and after this file was added. So this can sit in main harmlessly
// through builds that have no FCM set up yet, and Android push begins working
// the moment GOOGLE_SERVICES_JSON exists, with no further code change.
//
// Setup steps: docs/ANDROID-PUSH-FCM.md

const appJson = require('./app.json');

module.exports = () => {
  const expo = { ...appJson.expo };
  const googleServicesFile = process.env.GOOGLE_SERVICES_JSON;

  if (googleServicesFile) {
    expo.android = { ...expo.android, googleServicesFile };
  }

  // Google Maps on Android. react-native-maps needs an API key baked into the
  // Android manifest; without it every MapView renders a blank grey tile —
  // which is exactly what the first Play internal tester hit on 2026-08-03 in
  // the address pin picker and the live order-tracking map. iOS is unaffected
  // (Apple Maps, no key), which is why this shipped unnoticed: MapPinPicker's
  // own comment said "Android would need a Google Maps key" and nothing
  // enforced it. Same conditional pattern as the FCM file above, and for the
  // same reason: absent env var leaves the config byte-identical to app.json,
  // so this sits harmlessly in main until the key exists on EAS.
  //
  // The key is restricted (Android apps, this package + SHA-1) in the Google
  // console; a Maps key ships inside every APK by design, so restriction, not
  // secrecy, is what protects it.
  const mapsApiKey = process.env.GOOGLE_MAPS_API_KEY_ANDROID;

  if (mapsApiKey) {
    expo.android = {
      ...expo.android,
      config: {
        ...(expo.android || {}).config,
        googleMaps: { apiKey: mapsApiKey },
      },
    };
  }

  return { ...appJson, expo };
};
