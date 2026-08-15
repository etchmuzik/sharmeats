import { afterEach, describe, expect, it } from 'vitest';
import createConfig from './app.config.js';

const original = {
  profile: process.env.EAS_BUILD_PROFILE,
  platform: process.env.EAS_BUILD_PLATFORM,
  maps: process.env.GOOGLE_MAPS_API_KEY_ANDROID,
  services: process.env.GOOGLE_SERVICES_JSON,
};

afterEach(() => {
  for (const [key, value] of [
    ['EAS_BUILD_PROFILE', original.profile],
    ['EAS_BUILD_PLATFORM', original.platform],
    ['GOOGLE_MAPS_API_KEY_ANDROID', original.maps],
    ['GOOGLE_SERVICES_JSON', original.services],
  ]) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe('customer production build configuration', () => {
  it('fails Android production builds instead of shipping blank maps', () => {
    process.env.EAS_BUILD_PROFILE = 'production';
    process.env.EAS_BUILD_PLATFORM = 'android';
    delete process.env.GOOGLE_MAPS_API_KEY_ANDROID;
    process.env.GOOGLE_SERVICES_JSON = '/tmp/google-services.json';

    expect(() => createConfig()).toThrow('GOOGLE_MAPS_API_KEY_ANDROID');
  });

  it('fails Android production builds when push credentials are absent', () => {
    process.env.EAS_BUILD_PROFILE = 'production';
    process.env.EAS_BUILD_PLATFORM = 'android';
    process.env.GOOGLE_MAPS_API_KEY_ANDROID = 'maps-key';
    delete process.env.GOOGLE_SERVICES_JSON;

    expect(() => createConfig()).toThrow('GOOGLE_SERVICES_JSON');
  });

  it('does not fail an iOS production build on Android-only values', () => {
    // Both gated values are consumed only under expo.android. The EAS worker
    // evaluates this file with EAS_BUILD_PROFILE/PLATFORM set, so an unscoped
    // gate would break every iOS release AFTER upload — burning a capped build
    // credit for a key that build never reads.
    process.env.EAS_BUILD_PROFILE = 'production';
    process.env.EAS_BUILD_PLATFORM = 'ios';
    delete process.env.GOOGLE_MAPS_API_KEY_ANDROID;
    delete process.env.GOOGLE_SERVICES_JSON;

    expect(() => createConfig()).not.toThrow();
  });

  it('keeps local development optional and injects configured production values', () => {
    delete process.env.EAS_BUILD_PROFILE;
    delete process.env.EAS_BUILD_PLATFORM;
    delete process.env.GOOGLE_MAPS_API_KEY_ANDROID;
    delete process.env.GOOGLE_SERVICES_JSON;
    expect(createConfig().expo.android.config).toBeUndefined();

    process.env.EAS_BUILD_PROFILE = 'production';
    process.env.EAS_BUILD_PLATFORM = 'android';
    process.env.GOOGLE_MAPS_API_KEY_ANDROID = 'maps-key';
    process.env.GOOGLE_SERVICES_JSON = '/secure/google-services.json';
    const config = createConfig();
    expect(config.expo.android.googleServicesFile).toBe('/secure/google-services.json');
    expect(config.expo.android.config.googleMaps.apiKey).toBe('maps-key');
  });
});
