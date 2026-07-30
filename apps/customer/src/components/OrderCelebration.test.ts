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
    useSharedValue: (v: number) => ({ value: v }),
    useAnimatedStyle: (f: () => unknown) => f(),
    withTiming: (v: number) => v,
    withDelay: (_d: number, v: number) => v,
    withSpring: (v: number) => v,
  };
  return actual;
});

vi.mock('./Mascot/Mascot', () => ({
  Mascot: 'Mascot',
}));

vi.mock('./Confetti', () => ({
  Confetti: 'Confetti',
}));

vi.mock('../theme', () => ({
  colors: { white: '#fff', ink: '#000', ink2: '#666' },
  font: { sizes: { '7xl': 32, xl: 18 }, weights: { black: '900' } },
  radius: { xxxl: 24, pill: 50 },
  spacing: { xxxl: 24, xxl: 20, md: 12, sm: 8 },
  shadow: { card: {}, accentGlow: {} },
}));

// makeStyles is stubbed to run the factory once against the mocked palette.
// The real provider reaches react-native's useColorScheme, which drags in
// Flow-typed react-native source that vitest cannot parse; this test only
// exercises shouldCelebrate, a pure function.
vi.mock('../themeProvider', () => ({
  makeStyles: (factory: (c: Record<string, string>) => unknown) => () =>
    factory({ white: '#fff', ink: '#000', ink2: '#666', surface: '#fff', onAccent: '#fff' }),
  useThemeColors: () => ({ white: '#fff', ink: '#000', ink2: '#666' }),
}));

import { shouldCelebrate } from './OrderCelebration';

describe('shouldCelebrate — one-shot celebrate param gate', () => {
  it('true when param is "1"', () => { expect(shouldCelebrate('1')).toBe(true); });
  it('false when param absent', () => { expect(shouldCelebrate(undefined)).toBe(false); });
  it('false for any other value', () => { expect(shouldCelebrate('0')).toBe(false); });
  it('handles array params (expo-router repeats) by taking first', () => { expect(shouldCelebrate(['1'])).toBe(true); });
});
