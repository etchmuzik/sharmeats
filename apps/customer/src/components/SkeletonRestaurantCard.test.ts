import { describe, expect, it, vi } from 'vitest';

vi.mock('react-native', () => ({
  Animated: {
    Value: class {
      constructor(public value: number) {}
      setValue = vi.fn();
    },
    loop: vi.fn(),
    sequence: vi.fn(),
    timing: vi.fn(),
    View: 'AnimatedView',
  },
  AccessibilityInfo: {
    isReduceMotionEnabled: vi.fn(async () => false),
    addEventListener: vi.fn(() => ({ remove: vi.fn() })),
  },
  Easing: { ease: 'ease', inOut: (value: unknown) => value },
  View: 'View',
}));

vi.mock('../theme', () => ({ radius: { xl: 16, md: 12, sm: 8 }, shadow: { soft: {} } }));
vi.mock('../themeProvider', () => ({
  makeStyles: (factory: (colors: Record<string, string>) => unknown) => () =>
    factory({ surface: '#fff', line: '#ddd', bgSoft: '#eee' }),
}));

import { shouldAnimateSkeleton } from './SkeletonRestaurantCard';

describe('shouldAnimateSkeleton', () => {
  it('waits for the accessibility preference before animating', () => {
    expect(shouldAnimateSkeleton(null)).toBe(false);
  });

  it('keeps a static placeholder when Reduce Motion is enabled', () => {
    expect(shouldAnimateSkeleton(true)).toBe(false);
  });

  it('animates only when motion is allowed', () => {
    expect(shouldAnimateSkeleton(false)).toBe(true);
  });
});
