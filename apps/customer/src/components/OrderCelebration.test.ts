import { describe, it, expect, vi } from 'vitest';

vi.mock('react-native', () => ({
  StyleSheet: { create: (s: unknown) => s },
  View: 'View',
  Text: 'Text',
  Pressable: 'Pressable',
  AccessibilityInfo: { isReduceMotionEnabled: vi.fn(async () => false) },
}));

vi.mock('react-native-reanimated', () => {
  const actual = {
    default: { View: 'AV', createAnimatedComponent: (c: unknown) => c },
    Easing: { cubic: 'cubic', out: (value: unknown) => value },
    useSharedValue: (v: number) => ({ value: v }),
    useAnimatedStyle: (f: () => unknown) => f(),
    withTiming: (v: number) => v,
  };
  return actual;
});

vi.mock('./Icon', () => ({ Icon: 'Icon' }));

vi.mock('../theme', () => ({
  colors: { white: '#fff', ink: '#000', ink2: '#666' },
  font: { sizes: { '7xl': 32, xl: 18 }, weights: { black: '900' } },
  radius: { xxxl: 24, pill: 50 },
  spacing: { xxxl: 24, xxl: 20, xs: 4, sm: 8 },
  shadow: { card: {} },
}));

// makeStyles is stubbed to run the factory once against the mocked palette.
// The real provider reaches react-native's useColorScheme, which drags in
// Flow-typed react-native source that vitest cannot parse; this test only
// exercises shouldCelebrate, a pure function.
vi.mock('../themeProvider', () => ({
  makeStyles: (factory: (c: Record<string, string>) => unknown) => () =>
    factory({ white: '#fff', ink: '#000', ink2: '#666', surface: '#fff', green: '#0a0', greenSoft: '#dfd' }),
  useThemeColors: () => ({ white: '#fff', ink: '#000', ink2: '#666' }),
}));

import {
  ORDER_CONFIRMATION_ENTER_DURATION_MS,
  orderConfirmationMessageKey,
  shouldAnimateOrderConfirmation,
  shouldCelebrate,
} from './OrderCelebration';

describe('shouldCelebrate — one-shot celebrate param gate', () => {
  it('true when param is "1"', () => { expect(shouldCelebrate('1')).toBe(true); });
  it('false when param absent', () => { expect(shouldCelebrate(undefined)).toBe(false); });
  it('false for any other value', () => { expect(shouldCelebrate('0')).toBe(false); });
  it('handles array params (expo-router repeats) by taking first', () => { expect(shouldCelebrate(['1'])).toBe(true); });
});

describe('order confirmation motion', () => {
  it('uses a short, calm entrance when motion is allowed', () => {
    expect(ORDER_CONFIRMATION_ENTER_DURATION_MS).toBe(200);
    expect(shouldAnimateOrderConfirmation(false)).toBe(true);
  });

  it('skips the entrance animation when Reduce Motion is enabled', () => {
    expect(shouldAnimateOrderConfirmation(true)).toBe(false);
  });
});

describe('order confirmation payment copy', () => {
  it('keeps pay-on-delivery wording exclusive to cash orders', () => {
    expect(orderConfirmationMessageKey('cash', false)).toBe('celebration.cod');
    expect(orderConfirmationMessageKey('cash', true)).toBe('celebration.codEta');
  });

  it('uses neutral confirmation wording for prepaid and wallet orders', () => {
    expect(orderConfirmationMessageKey('card', false)).toBe('celebration.confirmed');
    expect(orderConfirmationMessageKey('vodafone_cash', true)).toBe('celebration.confirmedEta');
  });
});
