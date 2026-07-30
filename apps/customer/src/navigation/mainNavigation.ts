import type { IconName } from '../components/Icon';

export type MainTabKey = 'home' | 'browse' | 'cart' | 'orders' | 'profile';

export interface MainTabDefinition {
  key: MainTabKey;
  icon: IconName;
  tKey: string;
  path: string;
}

/**
 * The five destinations customers use while ordering.
 *
 * Rewards remains a complete screen, but lives under Account instead of
 * competing with ordering and tracking for permanent navigation space.
 */
export const MAIN_TABS: readonly MainTabDefinition[] = [
  { key: 'home', icon: 'home', tKey: 'tabs.home', path: '/(tabs)/home' },
  { key: 'browse', icon: 'search', tKey: 'tabs.browse', path: '/(tabs)/browse' },
  { key: 'cart', icon: 'cart', tKey: 'tabs.cart', path: '/(tabs)/cart' },
  { key: 'orders', icon: 'receipt', tKey: 'tabs.orders', path: '/(tabs)/orders' },
  { key: 'profile', icon: 'person', tKey: 'tabs.profile', path: '/(tabs)/profile' },
] as const;

export const ACCOUNT_ROUTES = {
  rewards: '/(tabs)/rewards',
} as const;

/** Resolve the selected persistent tab, including account-owned sub-screens. */
export function mainTabKeyForPath(pathname: string): MainTabKey | null {
  if (pathname.includes('/rewards')) return 'profile';
  return MAIN_TABS.find((tab) => pathname.includes(`/${tab.key}`))?.key ?? null;
}
