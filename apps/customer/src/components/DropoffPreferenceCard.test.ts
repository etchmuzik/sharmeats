import { describe, it, expect, vi } from 'vitest';

// This module (and its transitive deps: haptics.ts, deviceLocale.ts) import
// value bindings from 'react-native'. The project's vitest setup has no
// Flow/Metro transform, so RN's own source fails to parse under Vite's SSR
// transform unless stubbed here — mirrors the AsyncStorage mock pattern in
// store/cart.test.ts.
vi.mock('react-native', () => ({
  Platform: { OS: 'ios', select: (opts: Record<string, unknown>) => opts.ios },
  NativeModules: {},
  StyleSheet: { create: (styles: unknown) => styles },
  Pressable: 'Pressable',
  Text: 'Text',
  View: 'View',
}));
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn(async () => null),
    setItem: vi.fn(async () => {}),
    removeItem: vi.fn(async () => {}),
  },
}));
vi.mock('expo-haptics', () => ({
  selectionAsync: vi.fn(async () => {}),
  impactAsync: vi.fn(async () => {}),
  notificationAsync: vi.fn(async () => {}),
}));
// The component uses the production Ionicons wrapper. Vitest runs without
// Metro's asset/Flow transforms, so mock the package boundary instead of
// evaluating every icon module in @expo/vector-icons.
vi.mock('@expo/vector-icons', () => ({
  Ionicons: () => null,
}));

import { getVisibleChips, isQuietPreference } from './DropoffPreferenceCard';

describe('getVisibleChips — chip visibility filtering by address kind', () => {
  it('returns all 5 chips for addressKind "street"', () => {
    expect(getVisibleChips('street')).toHaveLength(5);
  });

  it('returns all 5 chips for addressKind undefined', () => {
    expect(getVisibleChips(undefined)).toHaveLength(5);
  });

  it('returns 4 chips (missing leave_at_door) for "hotel"', () => {
    const chips = getVisibleChips('hotel');
    expect(chips).toHaveLength(4);
    expect(chips.some((c) => c.value === 'leave_at_door')).toBe(false);
  });

  it('returns 4 chips (missing leave_at_door) for "beach_pin"', () => {
    const chips = getVisibleChips('beach_pin');
    expect(chips).toHaveLength(4);
    expect(chips.some((c) => c.value === 'leave_at_door')).toBe(false);
  });
});

describe('isQuietPreference — banner-trigger logic', () => {
  it('returns true for "leave_at_door"', () => {
    expect(isQuietPreference('leave_at_door')).toBe(true);
  });

  it('returns true for "no_bell"', () => {
    expect(isQuietPreference('no_bell')).toBe(true);
  });

  it('returns false for "hand_to_me"', () => {
    expect(isQuietPreference('hand_to_me')).toBe(false);
  });

  it('returns false for "meet_outside"', () => {
    expect(isQuietPreference('meet_outside')).toBe(false);
  });

  it('returns false for "call_on_arrival"', () => {
    expect(isQuietPreference('call_on_arrival')).toBe(false);
  });

  it('returns false for null', () => {
    expect(isQuietPreference(null)).toBe(false);
  });
});
