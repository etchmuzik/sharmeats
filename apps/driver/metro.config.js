// Use Sentry's Expo Metro config wrapper (getSentryExpoConfig) instead of
// Expo's getDefaultConfig. It returns the same default Expo config plus the
// Sentry serializer, which stamps a Debug ID into both the JS bundle and its
// source map so the maps uploaded during the EAS native build (via the
// @sentry/react-native config plugin) can be matched to release stack traces.
// Drop-in replacement — no behavioural change when Sentry upload is disabled.
const { getSentryExpoConfig } = require('@sentry/react-native/metro');

const config = getSentryExpoConfig(__dirname);

module.exports = config;
