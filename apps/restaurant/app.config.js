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
// outright. For local and preview work, omitting the key leaves the resolved
// config byte-identical to app.json. A production Android restaurant build is
// different: it must refuse to build without FCM rather than ship a kitchen
// app that cannot receive new-order notifications.
//
// Setup steps: docs/ANDROID-PUSH-FCM.md

const appJson = require('./app.json');

module.exports = () => {
  const expo = { ...appJson.expo };
  const googleServicesFile = process.env.GOOGLE_SERVICES_JSON;

  if (
    process.env.EAS_BUILD_PROFILE === 'production' &&
    process.env.EAS_BUILD_PLATFORM === 'android' &&
    !googleServicesFile
  ) {
    throw new Error(
      'Restaurant production Android build is missing required EAS environment: GOOGLE_SERVICES_JSON',
    );
  }

  if (googleServicesFile) {
    expo.android = { ...expo.android, googleServicesFile };
  }

  return { ...appJson, expo };
};
