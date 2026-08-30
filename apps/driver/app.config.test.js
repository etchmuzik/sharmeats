import { afterEach, describe, expect, it } from 'vitest';
import createConfig from './app.config.js';

const original = {
  profile: process.env.EAS_BUILD_PROFILE,
  platform: process.env.EAS_BUILD_PLATFORM,
  services: process.env.GOOGLE_SERVICES_JSON,
};

afterEach(() => {
  for (const [key, value] of [
    ['EAS_BUILD_PROFILE', original.profile],
    ['EAS_BUILD_PLATFORM', original.platform],
    ['GOOGLE_SERVICES_JSON', original.services],
  ]) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe('driver production Android build configuration', () => {
  it('fails instead of shipping a driver build without FCM', () => {
    process.env.EAS_BUILD_PROFILE = 'production';
    process.env.EAS_BUILD_PLATFORM = 'android';
    delete process.env.GOOGLE_SERVICES_JSON;

    expect(() => createConfig()).toThrow('GOOGLE_SERVICES_JSON');
  });

  it('does not require Android-only FCM configuration for an iOS build', () => {
    process.env.EAS_BUILD_PROFILE = 'production';
    process.env.EAS_BUILD_PLATFORM = 'ios';
    delete process.env.GOOGLE_SERVICES_JSON;

    expect(() => createConfig()).not.toThrow();
  });

  it('keeps preview Android builds usable before FCM is configured', () => {
    process.env.EAS_BUILD_PROFILE = 'preview';
    process.env.EAS_BUILD_PLATFORM = 'android';
    delete process.env.GOOGLE_SERVICES_JSON;

    expect(() => createConfig()).not.toThrow();
  });

  it('injects the configured FCM file into an Android production build', () => {
    process.env.EAS_BUILD_PROFILE = 'production';
    process.env.EAS_BUILD_PLATFORM = 'android';
    process.env.GOOGLE_SERVICES_JSON = '/secure/driver-google-services.json';

    expect(createConfig().expo.android.googleServicesFile).toBe(
      '/secure/driver-google-services.json',
    );
  });
});
