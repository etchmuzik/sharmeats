const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// posthog-react-native v4 imports @posthog/core through package-exports
// subpaths (e.g. `@posthog/core/surveys`). Metro on SDK 52 does not read
// `exports` maps by default, so the production bundle fails to resolve them.
config.resolver.unstable_enablePackageExports = true;

module.exports = config;
