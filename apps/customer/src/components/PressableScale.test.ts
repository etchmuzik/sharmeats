import { describe, it, expect, vi } from 'vitest';

vi.mock('react-native', () => ({
  Platform: { OS: 'ios', select: (o: Record<string, unknown>) => o.ios },
  StyleSheet: { create: (s: unknown) => s },
  Pressable: 'Pressable',
  AccessibilityInfo: { isReduceMotionEnabled: vi.fn(async () => false) },
}));
vi.mock('react-native-reanimated', () => ({
  default: { View: 'AnimatedView', createAnimatedComponent: (c: unknown) => c },
  useSharedValue: (v: number) => ({ value: v }),
  useAnimatedStyle: (fn: () => unknown) => fn(),
  withSpring: (v: number) => v,
}));
vi.mock('expo-haptics', () => ({
  selectionAsync: vi.fn(), impactAsync: vi.fn(), notificationAsync: vi.fn(),
}));

import { resolvePressHaptic } from './PressableScale';
import * as haptics from '../haptics';

describe('resolvePressHaptic — maps kind to haptic fn', () => {
  it('returns null for "none"', () => {
    expect(resolvePressHaptic('none')).toBeNull();
  });
  it('returns the tap fn for "tap"', () => {
    expect(resolvePressHaptic('tap')).toBe(haptics.tap);
  });
  it('returns the press fn for "press"', () => {
    expect(resolvePressHaptic('press')).toBe(haptics.press);
  });
  it('returns the selection fn for "selection"', () => {
    expect(resolvePressHaptic('selection')).toBe(haptics.selection);
  });
});
