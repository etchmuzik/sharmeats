import { describe, expect, it } from 'vitest';
import { ACCOUNT_ROUTES, MAIN_TABS, mainTabKeyForPath } from './mainNavigation';

describe('customer main navigation', () => {
  it('keeps the five frequent destinations in a stable order', () => {
    expect(MAIN_TABS.map((tab) => tab.key)).toEqual([
      'home',
      'browse',
      'cart',
      'orders',
      'profile',
    ]);
  });

  it('does not spend a permanent tab on rewards', () => {
    expect(MAIN_TABS).toHaveLength(5);
    expect(MAIN_TABS.map((tab) => String(tab.key))).not.toContain('rewards');
  });

  it('keeps rewards reachable from the account screen', () => {
    expect(ACCOUNT_ROUTES.rewards).toBe('/(tabs)/rewards');
  });

  it('keeps Account selected while the customer views rewards', () => {
    expect(mainTabKeyForPath('/(tabs)/rewards')).toBe('profile');
    expect(mainTabKeyForPath('/rewards')).toBe('profile');
  });

  it('recognises both Expo Router and public forms of primary tab paths', () => {
    expect(mainTabKeyForPath('/(tabs)/browse')).toBe('browse');
    expect(mainTabKeyForPath('/orders')).toBe('orders');
  });

  it('does not define duplicate tab keys or paths', () => {
    expect(new Set(MAIN_TABS.map((tab) => tab.key)).size).toBe(MAIN_TABS.length);
    expect(new Set(MAIN_TABS.map((tab) => tab.path)).size).toBe(MAIN_TABS.length);
  });
});
