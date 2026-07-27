import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// expo-constants / expo-updates are native modules; mock them so the resolver's
// LOGIC can be tested, including the paths where expo-updates throws (Expo Go
// and dev clients with updates disabled) — that is the branch most likely to
// crash a real device, and the reason this module wraps every read.
const mockConstants: { expoConfig: Record<string, unknown> | null } = { expoConfig: null };
const mockUpdates: Record<string, unknown> = {};

vi.mock('expo-constants', () => ({
  default: {
    get expoConfig() {
      return mockConstants.expoConfig;
    },
  },
}));

vi.mock('expo-updates', () => ({
  get updateId() {
    if (mockUpdates.throws) throw new Error('updates disabled');
    return mockUpdates.updateId;
  },
  get channel() {
    if (mockUpdates.throws) throw new Error('updates disabled');
    return mockUpdates.channel;
  },
  get runtimeVersion() {
    if (mockUpdates.throws) throw new Error('updates disabled');
    return mockUpdates.runtimeVersion;
  },
  get isEmbeddedLaunch() {
    if (mockUpdates.throws) throw new Error('updates disabled');
    return mockUpdates.isEmbeddedLaunch;
  },
}));

import { getReleaseInfo, releaseProperties, formatReleaseLine } from './release';

const ORIGINAL_SHA = process.env.EXPO_PUBLIC_GIT_SHA;

beforeEach(() => {
  mockConstants.expoConfig = {
    version: '1.1.0',
    ios: { buildNumber: '34' },
    runtimeVersion: { policy: 'appVersion' },
  };
  for (const k of Object.keys(mockUpdates)) delete mockUpdates[k];
  mockUpdates.updateId = null;
  mockUpdates.channel = 'production';
  mockUpdates.runtimeVersion = '1.1.0';
  mockUpdates.isEmbeddedLaunch = true;
  delete process.env.EXPO_PUBLIC_GIT_SHA;
});

afterEach(() => {
  if (ORIGINAL_SHA === undefined) delete process.env.EXPO_PUBLIC_GIT_SHA;
  else process.env.EXPO_PUBLIC_GIT_SHA = ORIGINAL_SHA;
});

describe('getReleaseInfo', () => {
  it('reads version, build and runtime from the running app', () => {
    const info = getReleaseInfo();
    expect(info.version).toBe('1.1.0');
    expect(info.buildNumber).toBe('34');
    expect(info.runtimeVersion).toBe('1.1.0');
    expect(info.channel).toBe('production');
  });

  it('reports an embedded launch when no OTA update has been applied', () => {
    const info = getReleaseInfo();
    expect(info.isEmbedded).toBe(true);
    expect(info.updateId).toBeNull();
  });

  it('reports the update id when an OTA update IS applied', () => {
    // The case a build number alone cannot distinguish: same binary, different JS.
    mockUpdates.updateId = '9f8e7d6c-1111-2222-3333-444455556666';
    mockUpdates.isEmbeddedLaunch = false;
    const info = getReleaseInfo();
    expect(info.updateId).toBe('9f8e7d6c-1111-2222-3333-444455556666');
    expect(info.isEmbedded).toBe(false);
  });

  it('does not throw when expo-updates is unavailable (Expo Go / dev client)', () => {
    mockUpdates.throws = true;
    const info = getReleaseInfo();
    // Native config still resolves; update fields degrade to unknown.
    expect(info.version).toBe('1.1.0');
    expect(info.updateId).toBeNull();
    expect(info.channel).toBeNull();
    expect(info.isEmbedded).toBe(true); // fallback: no updateId => embedded
  });

  it('survives a completely absent expo config', () => {
    mockConstants.expoConfig = null;
    mockUpdates.throws = true;
    expect(() => getReleaseInfo()).not.toThrow();
    const info = getReleaseInfo();
    expect(info.version).toBeNull();
    expect(info.buildNumber).toBeNull();
  });

  it('falls back to the Android versionCode when there is no iOS buildNumber', () => {
    mockConstants.expoConfig = { version: '1.1.0', android: { versionCode: 34 } };
    expect(getReleaseInfo().buildNumber).toBe('34');
  });

  it('ignores a runtimeVersion policy object when the resolved value is missing', () => {
    // config holds {policy:'appVersion'}, which is not a usable identifier.
    mockUpdates.runtimeVersion = null;
    expect(getReleaseInfo().runtimeVersion).toBeNull();
  });

  it('reads the build-time commit and derives a short form', () => {
    process.env.EXPO_PUBLIC_GIT_SHA = '33ff42d8997114821164e91884e926da05197595';
    const info = getReleaseInfo();
    expect(info.commit).toBe('33ff42d8997114821164e91884e926da05197595');
    expect(info.shortCommit).toBe('33ff42d');
  });

  it('reports a null commit rather than guessing when the SHA was not injected', () => {
    const info = getReleaseInfo();
    expect(info.commit).toBeNull();
    expect(info.shortCommit).toBeNull();
  });

  it('treats an empty-string SHA as absent', () => {
    process.env.EXPO_PUBLIC_GIT_SHA = '   ';
    expect(getReleaseInfo().commit).toBeNull();
  });
});

describe('releaseProperties', () => {
  it('omits unknown fields instead of emitting nulls', () => {
    mockUpdates.throws = true;
    mockConstants.expoConfig = { version: '1.1.0' };
    const props = releaseProperties();
    expect(props).toEqual({ app_version: '1.1.0', app_is_embedded: true });
    expect(Object.values(props)).not.toContain(null);
  });

  it('carries the full identity when everything is known', () => {
    process.env.EXPO_PUBLIC_GIT_SHA = 'abcdef1234567890';
    mockUpdates.updateId = 'update-1';
    mockUpdates.isEmbeddedLaunch = false;
    const props = releaseProperties();
    expect(props).toMatchObject({
      app_version: '1.1.0',
      app_build: '34',
      app_channel: 'production',
      app_update_id: 'update-1',
      app_commit: 'abcdef1234567890',
      app_is_embedded: false,
    });
  });

  it('contains no user-identifying keys', () => {
    process.env.EXPO_PUBLIC_GIT_SHA = 'abcdef1234567890';
    const keys = Object.keys(releaseProperties()).join(' ');
    for (const banned of ['phone', 'email', 'address', 'token', 'user']) {
      expect(keys).not.toContain(banned);
    }
  });
});

describe('formatReleaseLine', () => {
  it('renders a one-line operator summary', () => {
    process.env.EXPO_PUBLIC_GIT_SHA = '33ff42d8997114821164e91884e926da05197595';
    expect(formatReleaseLine()).toBe('1.1.0 (34) · 33ff42d · production · embedded');
  });

  it('names the applied update when one is running', () => {
    mockUpdates.updateId = '9f8e7d6c-1111-2222';
    mockUpdates.isEmbeddedLaunch = false;
    expect(formatReleaseLine()).toContain('update 9f8e7d6c');
  });

  it('never renders "undefined" when everything is unknown', () => {
    mockConstants.expoConfig = null;
    mockUpdates.throws = true;
    const line = formatReleaseLine();
    expect(line).not.toContain('undefined');
    expect(line).not.toContain('null');
  });
});
