import { beforeEach, describe, it, expect, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  isReduceMotionEnabled: vi.fn<() => Promise<boolean>>(),
  addEventListener: vi.fn<(
    event: 'reduceMotionChanged',
    listener: (enabled: boolean) => void,
  ) => { remove: () => void }>(),
  removeListener: vi.fn(),
  listener: null as ((enabled: boolean) => void) | null,
}));

vi.mock('react-native', () => ({
  Platform: { OS: 'ios', select: (o: Record<string, unknown>) => o.ios },
  StyleSheet: { create: (s: unknown) => s },
  Pressable: 'Pressable',
  AccessibilityInfo: {
    isReduceMotionEnabled: mocks.isReduceMotionEnabled,
    addEventListener: mocks.addEventListener,
  },
}));
vi.mock('react-native-reanimated', () => ({
  default: { View: 'AnimatedView', createAnimatedComponent: (c: unknown) => c },
  useSharedValue: (v: number) => ({ value: v }),
  useAnimatedStyle: (fn: () => unknown) => fn(),
  withSpring: (v: number) => v,
  withTiming: (v: number) => v,
}));
vi.mock('expo-haptics', () => ({
  selectionAsync: vi.fn(), impactAsync: vi.fn(), notificationAsync: vi.fn(),
}));

import {
  DEFAULT_REDUCE_MOTION,
  PRESS_FEEDBACK_DURATION_MS,
  resolvePressHaptic,
  shouldAnimatePressFeedback,
  subscribeToReduceMotion,
} from './PressableScale';
import * as haptics from '../haptics';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.listener = null;
  mocks.isReduceMotionEnabled.mockResolvedValue(false);
  mocks.addEventListener.mockImplementation((_event, listener) => {
    mocks.listener = listener;
    return { remove: mocks.removeListener };
  });
});

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

describe('press feedback motion', () => {
  it('starts in the Reduce Motion-safe state until the system preference resolves', () => {
    expect(DEFAULT_REDUCE_MOTION).toBe(true);
    expect(shouldAnimatePressFeedback(DEFAULT_REDUCE_MOTION)).toBe(false);
  });

  it('uses a short non-spring feedback window', () => {
    expect(PRESS_FEEDBACK_DURATION_MS).toBe(90);
  });

  it('respects Reduce Motion', () => {
    expect(shouldAnimatePressFeedback(false)).toBe(true);
    expect(shouldAnimatePressFeedback(true)).toBe(false);
  });

  it('tracks live Reduce Motion changes and unsubscribes cleanly', async () => {
    const onChange = vi.fn();
    const unsubscribe = subscribeToReduceMotion(onChange);

    expect(mocks.addEventListener).toHaveBeenCalledWith('reduceMotionChanged', expect.any(Function));

    await Promise.resolve();
    expect(onChange).toHaveBeenCalledWith(false);

    mocks.listener?.(true);
    expect(onChange).toHaveBeenLastCalledWith(true);

    unsubscribe();
    expect(mocks.removeListener).toHaveBeenCalledOnce();

    mocks.listener?.(false);
    expect(onChange).toHaveBeenCalledTimes(2);
  });
});
