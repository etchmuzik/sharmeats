import { describe, expect, it, vi } from 'vitest';

vi.mock('react-native', () => ({
  Animated: {
    Value: class {
      constructor(public value: number) {}
      setValue = vi.fn();
      stopAnimation = vi.fn();
    },
    sequence: vi.fn(),
    timing: vi.fn(),
  },
  AccessibilityInfo: {
    isReduceMotionEnabled: vi.fn(async () => false),
    addEventListener: vi.fn(() => ({ remove: vi.fn() })),
  },
  Text: 'Text',
  View: 'View',
}));

vi.mock('expo-router', () => ({ usePathname: vi.fn(), useRouter: vi.fn() }));
vi.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: vi.fn() }));
vi.mock('../theme', () => ({
  font: { sizes: { xs: 12 }, weights: { bold: '700' } },
  radius: { pill: 999 },
  shadow: { nav: {} },
}));
vi.mock('../themeProvider', () => ({
  makeStyles: (factory: (colors: Record<string, string>) => unknown) => () => factory({}),
  useThemeColors: vi.fn(),
}));
vi.mock('../haptics', () => ({ selection: vi.fn() }));
vi.mock('../store/cart', () => ({ useCart: vi.fn() }));
vi.mock('../hooks/useUnreadBadges', () => ({ useUnreadBadges: vi.fn() }));
vi.mock('../i18n', () => ({ useT: vi.fn() }));
vi.mock('../navigation/mainNavigation', () => ({ MAIN_TABS: [], mainTabKeyForPath: vi.fn() }));
vi.mock('./Icon', () => ({ Icon: 'Icon' }));
vi.mock('./PressableScale', () => ({ PressableScale: 'PressableScale' }));

import { CART_BADGE_FEEDBACK, shouldAnimateCartBadge } from './TabBar';

describe('cart badge feedback', () => {
  it('uses a short, subtle feedback window', () => {
    expect(CART_BADGE_FEEDBACK).toEqual({
      peakScale: 1.08,
      riseDurationMs: 80,
      settleDurationMs: 120,
    });
  });

  it('animates only a newly added cart item when motion is allowed', () => {
    expect(shouldAnimateCartBadge(1, 2, false)).toBe(true);
    expect(shouldAnimateCartBadge(2, 2, false)).toBe(false);
    expect(shouldAnimateCartBadge(2, 1, false)).toBe(false);
  });

  it('does not animate cart feedback with Reduce Motion enabled', () => {
    expect(shouldAnimateCartBadge(1, 2, true)).toBe(false);
  });
});
