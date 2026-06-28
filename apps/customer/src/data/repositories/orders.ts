import { DEFAULT_USER } from '../mock/user';
import { pickRandomRider } from '../mock/riders';
import { restaurantsRepo } from './restaurants';
import type {
  Address,
  AllergyKey,
  CartItem,
  Order,
  OrderStatus,
  PaymentMethodKind,
} from '../types';

/**
 * Mock promo rules — mirrors the live validate_promo RPC shape so the checkout
 * flow can be exercised offline. WELCOME10: 10% off, capped at EGP 50.
 */
function mockPromoDiscount(code: string | undefined, subtotal: number): number {
  if (!code) return 0;
  if (code.trim().toUpperCase() !== 'WELCOME10') return 0;
  return Math.min(Math.round(subtotal * 0.1), 50);
}

const delay = <T>(value: T, ms = 80): Promise<T> =>
  new Promise((resolve) => setTimeout(() => resolve(value), ms));

const orders = new Map<string, Order>();
const subscribers = new Map<string, Set<(o: Order) => void>>();

function shortCode(): string {
  const a = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = '';
  for (let i = 0; i < 6; i += 1) out += a[Math.floor(Math.random() * a.length)];
  return out;
}

function makeId(): string {
  return `o-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

const STATUS_SEQUENCE: { status: OrderStatus; afterMs: number }[] = [
  { status: 'accepted', afterMs: 6000 },
  { status: 'preparing', afterMs: 14000 },
  { status: 'ready', afterMs: 28000 },
  { status: 'out_for_delivery', afterMs: 36000 },
  { status: 'delivered', afterMs: 90000 },
];

function notify(orderId: string) {
  const o = orders.get(orderId);
  if (!o) return;
  const set = subscribers.get(orderId);
  set?.forEach((cb) => {
    try {
      cb(o);
    } catch {
      /* ignore */
    }
  });
}

function scheduleStatusProgression(orderId: string) {
  STATUS_SEQUENCE.forEach((step) => {
    setTimeout(() => {
      const o = orders.get(orderId);
      if (!o || o.status === 'cancelled' || o.status === 'delivered') return;
      const next: Order = {
        ...o,
        status: step.status,
        history: [...o.history, { status: step.status, at: Date.now() }],
        deliveredAt: step.status === 'delivered' ? Date.now() : o.deliveredAt,
      };
      orders.set(orderId, next);
      notify(orderId);
    }, step.afterMs);
  });
}

export interface CreateOrderInput {
  restaurantId: string;
  restaurantName: string;
  items: CartItem[];
  address: Address;
  payment: { kind: PaymentMethodKind; label: string };
  tipEgp?: number;
  deliveryFeeEgp: number;
  taxRate?: number;
  kitchenNotes?: string;
  aggregateAllergens?: AllergyKey[];
  scheduledFor?: number;
  /** Optional promo code — the server (or mock rules) revalidates it. */
  promoCode?: string;
  /** Customer contact phone for THIS order — the driver calls this number. */
  customerPhone?: string;
  /**
   * Per-checkout idempotency key (uuid). Stable across retries of the SAME
   * checkout attempt so a double-tap or network retry returns the existing
   * order instead of creating a duplicate. Generated once per checkout screen.
   */
  idempotencyKey?: string;
}

export const ordersRepo = {
  async create(input: CreateOrderInput): Promise<Order> {
    const subtotal = input.items.reduce((acc, ci) => {
      const mods = ci.modifierChoices.reduce((m, c) => m + c.priceDeltaEgp, 0);
      return acc + (ci.basePriceEgp + mods) * ci.quantity;
    }, 0);
    // Tax-inclusive at launch (mirrors place_order's v_tax := 0).
    const tax = Math.round(subtotal * (input.taxRate ?? 0));
    const tip = input.tipEgp ?? 0;
    const discount = mockPromoDiscount(input.promoCode, subtotal);
    const total = Math.max(0, subtotal + input.deliveryFeeEgp + tax + tip - discount);
    const id = makeId();
    const placedAt = Date.now();
    const slaMinutes = 30;
    const o: Order = {
      id,
      shortCode: `SE-${shortCode()}`,
      userId: DEFAULT_USER.id,
      restaurantId: input.restaurantId,
      restaurantName: input.restaurantName,
      addressId: input.address.id,
      addressSnapshot: input.address,
      items: input.items,
      subtotalEgp: subtotal,
      deliveryFeeEgp: input.deliveryFeeEgp,
      taxEgp: tax,
      tipEgp: tip,
      totalEgp: total,
      paymentMethodKind: input.payment.kind,
      paymentLabel: input.payment.label,
      paymentStatus: 'pending',
      status: 'placed',
      history: [{ status: 'placed', at: placedAt }],
      placedAt,
      etaAt: placedAt + slaMinutes * 60_000,
      slaMinutes,
      rider: pickRandomRider(),
      kitchenNotes: input.kitchenNotes,
      aggregateAllergens: input.aggregateAllergens,
      scheduledFor: input.scheduledFor,
      discountEgp: discount > 0 ? discount : undefined,
      promoCode: discount > 0 ? input.promoCode?.trim().toUpperCase() : undefined,
    };
    orders.set(id, o);
    scheduleStatusProgression(id);
    return delay(o, 200);
  },

  /**
   * Mock has no real payment gateway — card "checkout" is a no-op (returns null
   * so the caller skips opening a browser). Kept to mirror the Supabase adapter.
   */
  async startCardPayment(_orderId: string): Promise<{ checkoutUrl: string } | null> {
    return delay(null);
  },

  /** Mock fee quote — the restaurant's flat fee (live mode asks quote_delivery_fee). */
  async quoteDeliveryFee(
    restaurantId: string,
    _addressId: string,
    _subtotalEgp: number,
  ): Promise<number> {
    const r = await restaurantsRepo.get(restaurantId);
    return delay(r?.deliveryFeeEgp ?? 30);
  },

  /** Mock promo validation — mirrors the validate_promo RPC contract (0 = invalid). */
  async validatePromo(code: string, subtotalEgp: number): Promise<number> {
    return delay(mockPromoDiscount(code, subtotalEgp));
  },

  /**
   * Mock driver-location subscription. Emits a gently drifting fake position so
   * the tracking map shows movement in mock mode. Mirrors the Supabase adapter's
   * Realtime Broadcast subscription. Returns an unsubscribe fn.
   */
  subscribeDriverLocation(
    _orderId: string,
    cb: (loc: { lat: number; lng: number; heading?: number; at: number }) => void,
  ): () => void {
    let lat = 27.915;
    let lng = 34.33;
    const iv = setInterval(() => {
      lat += (Math.random() - 0.5) * 0.0008;
      lng += (Math.random() - 0.5) * 0.0008;
      cb({ lat, lng, at: Date.now() });
    }, 3000);
    return () => clearInterval(iv);
  },

  /** Mock cancel — flips the order to cancelled locally. */
  async cancel(orderId: string, _reason?: string): Promise<void> {
    const o = orders.get(orderId);
    if (o) {
      orders.set(orderId, {
        ...o,
        status: 'cancelled',
        history: [...o.history, { status: 'cancelled', at: Date.now() }],
      });
      notify(orderId);
    }
    return delay(undefined);
  },

  async get(id: string): Promise<Order | null> {
    return delay(orders.get(id) ?? null);
  },

  async list(): Promise<Order[]> {
    return delay(Array.from(orders.values()).sort((a, b) => b.placedAt - a.placedAt));
  },

  async listActive(): Promise<Order[]> {
    return delay(
      Array.from(orders.values())
        .filter(
          (o) =>
            o.status !== 'delivered' && o.status !== 'cancelled' && o.status !== 'rejected',
        )
        .sort((a, b) => b.placedAt - a.placedAt),
    );
  },

  async listPast(): Promise<Order[]> {
    return delay(
      Array.from(orders.values())
        .filter((o) => o.status === 'delivered' || o.status === 'cancelled')
        .sort((a, b) => b.placedAt - a.placedAt),
    );
  },

  /** Subscribe to status changes for an order. Returns unsubscribe fn. */
  subscribe(orderId: string, cb: (o: Order) => void): () => void {
    let set = subscribers.get(orderId);
    if (!set) {
      set = new Set();
      subscribers.set(orderId, set);
    }
    set.add(cb);
    return () => {
      set?.delete(cb);
    };
  },

  /** Debug: jump an order to delivered immediately. */
  async forceDelivered(orderId: string): Promise<Order | null> {
    const o = orders.get(orderId);
    if (!o) return null;
    const next: Order = {
      ...o,
      status: 'delivered',
      deliveredAt: Date.now(),
      history: [...o.history, { status: 'delivered', at: Date.now() }],
    };
    orders.set(orderId, next);
    notify(orderId);
    return delay(next);
  },

  async submitReview(
    orderId: string,
    ratingFood: number,
    ratingDelivery: number,
    comment: string,
  ): Promise<Order | null> {
    const o = orders.get(orderId);
    if (!o) return null;
    const next: Order = { ...o, ratingFood, ratingDelivery, ratingComment: comment };
    orders.set(orderId, next);
    return delay(next);
  },
};
