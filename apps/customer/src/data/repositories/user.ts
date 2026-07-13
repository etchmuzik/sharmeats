import { DEFAULT_ADDRESSES, DEFAULT_PAYMENT_METHODS, DEFAULT_USER } from '../mock/user';
import type { Address, PaymentMethod, User } from '../types';
import { isPaymentMethodEnabled, withCashOnDelivery } from '../../lib/payments';

const delay = <T>(value: T, ms = 40): Promise<T> =>
  new Promise((resolve) => setTimeout(() => resolve(value), ms));

// Mutable in-memory copies so address/payment edits stick during a session.
let currentUser: User = { ...DEFAULT_USER };
let addresses: Address[] = [...DEFAULT_ADDRESSES];
let paymentMethods: PaymentMethod[] = [...DEFAULT_PAYMENT_METHODS];
const favoriteIds = new Set<string>();

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
};
