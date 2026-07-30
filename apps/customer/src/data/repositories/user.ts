import { DEFAULT_ADDRESSES, DEFAULT_PAYMENT_METHODS, DEFAULT_USER } from '../mock/user';
import { MENUS } from '../mock/menus';
import { RESTAURANTS } from '../mock/restaurants';
import type {
  Address,
  NotificationPrefs,
  NotificationPrefsPatch,
  PaymentMethod,
  SavedItem,
  User,
} from '../types';
import { isPaymentMethodEnabled, withCashOnDelivery } from '../../lib/payments';

const delay = <T>(value: T, ms = 40): Promise<T> =>
  new Promise((resolve) => setTimeout(() => resolve(value), ms));

// Mutable in-memory copies so address/payment edits stick during a session.
let currentUser: User = { ...DEFAULT_USER };
let addresses: Address[] = [...DEFAULT_ADDRESSES];
let paymentMethods: PaymentMethod[] = [...DEFAULT_PAYMENT_METHODS];
const favoriteIds = new Set<string>();
const favoriteItemIds = new Set<string>();

/**
 * Resolve a saved menu-item id against the mock catalogue. Returns null when
 * the item no longer exists, mirroring the live behaviour where the composite
 * FK cascades the favourite away with the item.
 */
function buildSavedItem(menuItemId: string): SavedItem | null {
  for (const [restaurantId, menu] of Object.entries(MENUS)) {
    const item = menu.items.find((i) => i.id === menuItemId);
    if (!item) continue;
    const restaurant = RESTAURANTS.find((r) => r.id === restaurantId);
    return {
      menuItemId: item.id,
      restaurantId,
      name: item.name,
      description: item.description,
      priceEgp: item.priceEgp,
      image: item.image,
      isAvailable: item.isAvailable,
      restaurantName: restaurant?.name ?? '',
      restaurantIsOpen: restaurant?.isOpen ?? true,
      restaurantIsActive: true,
      savedAt: Date.now(),
    };
  }
  return null;
}
// Defaults mirror mig 138's server-side defaults exactly: marketing is opt-IN.
let notificationPrefs: NotificationPrefs = {
  transactional: true,
  marketing: false,
  quietHoursStart: null,
  quietHoursEnd: null,
  timezone: 'Africa/Cairo',
};

export const userRepo = {
  async getMe(): Promise<User> {
    return delay(currentUser);
  },

  async update(patch: Partial<User>): Promise<User> {
    currentUser = { ...currentUser, ...patch };
    return delay(currentUser);
  },

  async listAddresses(): Promise<Address[]> {
    return delay(addresses);
  },

  async addAddress(a: Address): Promise<Address> {
    addresses = [...addresses, a];
    return delay(a);
  },

  async setDefaultAddress(id: string): Promise<Address[]> {
    addresses = addresses.map((a) => ({ ...a, isDefault: a.id === id }));
    currentUser = { ...currentUser, defaultAddressId: id };
    return delay(addresses);
  },

  async removeAddress(id: string): Promise<void> {
    addresses = addresses.filter((a) => a.id !== id);
    return delay(undefined);
  },

  async listPaymentMethods(): Promise<PaymentMethod[]> {
    return delay(withCashOnDelivery(paymentMethods.filter(isPaymentMethodEnabled)));
  },

  async setDefaultPaymentMethod(id: string): Promise<PaymentMethod[]> {
    paymentMethods = paymentMethods.map((p) => ({ ...p, isDefault: p.id === id }));
    currentUser = { ...currentUser, defaultPaymentMethodId: id };
    return delay(paymentMethods);
  },

  /** Mock push registration — no backend to deliver to, so these are no-ops. */
  async registerPushToken(_token: string, _platform: 'ios' | 'android' | 'web'): Promise<void> {
    return delay(undefined);
  },

  async unregisterPushToken(_token: string): Promise<void> {
    return delay(undefined);
  },

  // Mock favorites — the session store (AsyncStorage) is the offline source of
  // truth; this in-memory set just mirrors the live adapter's contract.
  async listFavorites(): Promise<string[]> {
    return delay(Array.from(favoriteIds));
  },

  async setFavorite(restaurantId: string, on: boolean): Promise<void> {
    if (on) favoriteIds.add(restaurantId);
    else favoriteIds.delete(restaurantId);
    return delay(undefined);
  },

  /** Mock referral code — stable stub so the invite screen renders offline. */
  async myReferralCode(): Promise<string> {
    return delay('SHARM-DEMO42');
  },

  /** Mock ToS acceptance — records the version on the in-memory user so a
   * subsequent getMe() reflects it (the consent checkpoint won't re-fire). */
  async recordTermsAcceptance(version: string): Promise<void> {
    currentUser = { ...currentUser, termsAcceptedVersion: version };
    return delay(undefined);
  },

  /**
   * Mock account deletion. There's no backend, so this just resets the
   * in-memory user state. Mirrors the live adapter's contract so the UI can
   * call `db.user.deleteAccount()` in either mode.
   */
  async deleteAccount(): Promise<void> {
    currentUser = { ...DEFAULT_USER };
    addresses = [...DEFAULT_ADDRESSES];
    paymentMethods = [...DEFAULT_PAYMENT_METHODS];
    favoriteIds.clear();
    return delay(undefined);
  },

  /** Saved dishes (mig 139 contract), newest first. */
  async listFavoriteItems(): Promise<SavedItem[]> {
    const items = Array.from(favoriteItemIds)
      .map((id) => buildSavedItem(id))
      .filter((s): s is SavedItem => s !== null);
    return delay(items);
  },

  async listFavoriteItemIds(): Promise<string[]> {
    return delay(Array.from(favoriteItemIds));
  },

  async setFavoriteItem(menuItemId: string, _restaurantId: string, on: boolean): Promise<void> {
    if (on) favoriteItemIds.add(menuItemId);
    else favoriteItemIds.delete(menuItemId);
    return delay(undefined);
  },

  /**
   * Mock notification prefs (mig 138 contract). Defaults mirror the server's
   * exactly — transactional on, marketing OFF — so mock mode cannot imply that
   * marketing is opt-out when live mode is opt-in.
   */
  async getNotificationPrefs(): Promise<NotificationPrefs> {
    return delay({ ...notificationPrefs });
  },

  async setNotificationPrefs(patch: NotificationPrefsPatch): Promise<NotificationPrefs> {
    notificationPrefs = {
      ...notificationPrefs,
      ...(patch.transactional !== undefined ? { transactional: patch.transactional } : {}),
      ...(patch.marketing !== undefined ? { marketing: patch.marketing } : {}),
      ...(patch.timezone !== undefined ? { timezone: patch.timezone } : {}),
      ...(patch.clearQuietHours
        ? { quietHoursStart: null, quietHoursEnd: null }
        : {
            ...(patch.quietHoursStart !== undefined ? { quietHoursStart: patch.quietHoursStart } : {}),
            ...(patch.quietHoursEnd !== undefined ? { quietHoursEnd: patch.quietHoursEnd } : {}),
          }),
    };
    return delay({ ...notificationPrefs });
  },

  /** Inbox page (Package 03 Slice H). Mock returns a small fixed history. */
  async notificationInbox(): Promise<import('../types').InboxMessage[]> {
    return delay([...mockInbox]);
  },

  /** Unread count for the badge. */
  async unreadNotificationCount(): Promise<number> {
    return delay(mockInbox.filter((m) => !m.readAt).length);
  },

  /** Mark one message read. First read wins, matching the server. */
  async markNotificationRead(messageId: string): Promise<void> {
    const i = mockInbox.findIndex((m) => m.id === messageId);
    if (i >= 0 && !mockInbox[i].readAt) {
      mockInbox[i] = { ...mockInbox[i], readAt: new Date().toISOString() };
    }
    return delay(undefined);
  },

  /**
   * Record that a notification was opened (Package 03 Slice F).
   *
   * The mock keeps the ids it was told about so a test can assert the call
   * happened, and swallows nothing — the LIVE adapter is where failure is
   * tolerated, because attribution must never break routing.
   */
  async recordNotificationOpen(messageId: string): Promise<void> {
    openedMessageIds.push(messageId);
    return delay(undefined);
  },
};

/** Test seam: which message ids the mock was asked to record. */
export const openedMessageIds: string[] = [];

/**
 * Mock inbox history.
 *
 * Deliberately mixed: one read, one unread, one campaign with custom copy, so the
 * screen's states are all exercisable offline. Note there is NO suppressed or
 * failed message here — the server never returns those (mig 179), so a mock that
 * included them would let the screen render something production cannot produce.
 */
const mockInbox: import('../types').InboxMessage[] = [
  {
    id: '11111111-1111-4111-8111-111111111111',
    event: 'order_delivered',
    category: 'operational',
    orderId: '22222222-2222-4222-8222-222222222222',
    queuedAt: new Date(Date.now() - 2 * 3600_000).toISOString(),
  },
  {
    id: '33333333-3333-4333-8333-333333333333',
    event: 'campaign',
    category: 'marketing',
    customTitle: 'Two for one this weekend',
    customBody: 'Selected restaurants in Naama Bay.',
    route: '/(tabs)/browse',
    queuedAt: new Date(Date.now() - 26 * 3600_000).toISOString(),
    readAt: new Date(Date.now() - 20 * 3600_000).toISOString(),
  },
  {
    id: '44444444-4444-4444-8444-444444444444',
    event: 'credit_issued',
    category: 'operational',
    route: '/(tabs)/rewards',
    queuedAt: new Date(Date.now() - 3 * 86400_000).toISOString(),
  },
];
