import { DEFAULT_ADDRESSES, DEFAULT_PAYMENT_METHODS, DEFAULT_USER } from '../mock/user';
import type { Address, PaymentMethod, User } from '../types';
import { isPaymentMethodEnabled, withCashOnDelivery } from '../../lib/payments';

const delay = <T>(value: T, ms = 40): Promise<T> =>
  new Promise((resolve) => setTimeout(() => resolve(value), ms));

// Mutable in-memory copies so address/payment edits stick during a session.
let currentUser: User = { ...DEFAULT_USER };
let addresses: Address[] = [...DEFAULT_ADDRESSES];
let paymentMethods: PaymentMethod[] = [...DEFAULT_PAYMENT_METHODS];

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
};
