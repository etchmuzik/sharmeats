/**
 * Supabase orders adapter — RPC-backed (server authority).
 *
 * Order creation goes through the `place_order` RPC, NOT a direct insert. The
 * server recomputes every price from DB values, validates the merchant/address/
 * items, writes orders + order_items + the first status event atomically, and
 * returns the authoritative total. The client total is never trusted.
 *
 * Payment:
 *   - cash_on_delivery: place_order is the whole flow (settles on delivery).
 *   - card: after place_order, call the paymob-create-intention edge function
 *     and open the hosted checkout (caller uses startCardPayment + web browser).
 *
 * Live tracking:
 *   - order status: Realtime postgres_changes on `orders` (subscribe()).
 *   - driver GPS: Realtime BROADCAST on `order:{id}:driver_loc`
 *     (subscribeDriverLocation()) — ephemeral, no DB writes.
 */
import { getSupabase } from './client';
import { rowToOrder } from './mappers';
import type { Order, PaymentMethodKind } from '../types';
import type { CreateOrderInput } from '../repositories/orders';

/** Map the app's payment kind to the order's payment_method ('card' | 'cash_on_delivery'). */
function toPaymentMethod(kind: PaymentMethodKind): 'card' | 'cash_on_delivery' {
  // Card-like rails go through Paymob; everything else is cash-on-delivery at MVP.
  return kind === 'card' || kind === 'apple_pay' ? 'card' : 'cash_on_delivery';
}

/** Build the RPC p_cart jsonb from the app's CartItem[]. */
function toCartPayload(items: CreateOrderInput['items']) {
  return items.map((ci) => ({
    item_id: ci.itemId,
    quantity: ci.quantity,
    modifier_option_ids: ci.modifierChoices.map((c) => c.optionId),
    notes: ci.notes ?? null,
  }));
}

export interface DriverLocation {
  lat: number;
  lng: number;
  heading?: number;
  at: number;
}

export const ordersRepoSupabase = {
  async create(input: CreateOrderInput): Promise<Order> {
    const sb = getSupabase();
    const {
      data: { user },
    } = await sb.auth.getUser();
    if (!user) throw new Error('Not authenticated');

    // Server-authoritative creation. Client total/fee are IGNORED by the RPC.
    const { data, error } = await sb.rpc('place_order', {
      p_restaurant_id: input.restaurantId,
      p_address_id: input.address.id,
      p_cart: toCartPayload(input.items),
      p_payment_method: toPaymentMethod(input.payment.kind),
      p_tip: input.tipEgp ?? 0,
      p_kitchen_notes: input.kitchenNotes ?? null,
      p_promo_code: input.promoCode?.trim() || null,
      p_scheduled_for: input.scheduledFor ? new Date(input.scheduledFor).toISOString() : null,
      p_customer_phone: input.customerPhone?.trim() || null,
      // [031] Idempotency: a retried/duplicated checkout with the same key
      // returns the existing order instead of creating a second one.
      p_idempotency_key: input.idempotencyKey ?? null,
      p_dropoff_preference: input.dropoffPreference ?? null,
      p_dropoff_note: input.dropoffNote?.trim() || null,
    });
    if (error) throw mapPlaceOrderError(error);

    // place_order returns [{ id, short_code, total_egp }]. Re-read the full order.
    const row = Array.isArray(data) ? data[0] : data;
    if (!row?.id) throw new Error('place_order returned no order id');

    const order = await this.get(row.id as string);
    if (!order) throw new Error('Order created but could not be read back');
    return order;
  },

  /**
   * For card orders: create a Paymob intention and return the hosted checkout
   * URL. The caller opens it with expo-web-browser. The paymob-webhook flips
   * payment_status to 'paid' server-side. Returns null for COD orders.
   */
  async startCardPayment(orderId: string): Promise<{ checkoutUrl: string } | null> {
    const sb = getSupabase();
    const {
      data: { session },
    } = await sb.auth.getSession();
    if (!session) throw new Error('Not authenticated');

    const { data, error } = await sb.functions.invoke('paymob-create-intention', {
      body: { orderId },
    });
    if (error) throw error;
    if (!data?.checkoutUrl) return null;
    return { checkoutUrl: data.checkoutUrl as string };
  },

  /**
   * Authoritative delivery-fee quote for the checkout display. Mirrors exactly
   * what place_order will charge (zone rule + free-over threshold), so the
   * "Place order · X" button never disagrees with the server total.
   */
  async quoteDeliveryFee(
    restaurantId: string,
    addressId: string,
    subtotalEgp: number,
  ): Promise<number> {
    const sb = getSupabase();
    // The RPC wants the dropoff geography; read it off the caller's address row
    // (RLS scopes addresses to the owner). PostGIS accepts the WKB/EWKT string back.
    const { data: addr, error: addrErr } = await sb
      .from('addresses')
      .select('geo')
      .eq('id', addressId)
      .maybeSingle();
    if (addrErr) throw addrErr;
    const { data, error } = await sb.rpc('quote_delivery_fee', {
      p_restaurant_id: restaurantId,
      p_dropoff: addr?.geo ?? null,
      p_subtotal: subtotalEgp,
    });
    if (error) throw error;
    return typeof data === 'number' ? data : 30;
  },

  /** Live promo validation (server authority). Returns the discount in EGP; 0 = invalid. */
  async validatePromo(code: string, subtotalEgp: number): Promise<number> {
    const { data, error } = await getSupabase().rpc('validate_promo', {
      p_code: code.trim(),
      p_subtotal: subtotalEgp,
    });
    if (error) throw error;
    return typeof data === 'number' ? data : 0;
  },

  async get(id: string): Promise<Order | null> {
    const { data, error } = await getSupabase()
      .from('orders')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    if (error) throw error;
    return data ? rowToOrder(data) : null;
  },

  async list(): Promise<Order[]> {
    const { data, error } = await getSupabase()
      .from('orders')
      .select('*')
      .order('placed_at', { ascending: false });
    if (error) throw error;
    return (data ?? []).map(rowToOrder);
  },

  async listActive(): Promise<Order[]> {
    const { data, error } = await getSupabase()
      .from('orders')
      .select('*')
      .not('status', 'in', '(delivered,cancelled,rejected)')
      .order('placed_at', { ascending: false });
    if (error) throw error;
    return (data ?? []).map(rowToOrder);
  },

  async listPast(): Promise<Order[]> {
    const { data, error } = await getSupabase()
      .from('orders')
      .select('*')
      .in('status', ['delivered', 'cancelled', 'rejected'])
      .order('placed_at', { ascending: false });
    if (error) throw error;
    return (data ?? []).map(rowToOrder);
  },

  /**
   * Subscribe to order status changes (Realtime postgres_changes).
   *
   * `subscriberKey` MUST be distinct per live subscriber of the SAME order.
   * Three components can watch one order at once: the always-mounted
   * ActiveOrderBanner (tabs layout), the Orders-tab list row, and the tracking
   * screen. Keying the channel only by orderId made all three share the name
   * `order:{id}:status`; the same-named teardown below then had the second
   * subscriber rip out the first's live channel, and its own unsub left the
   * survivors on a dead channel — the banner's status pill froze (showed
   * "Preparing" after delivery) until a tab-change refetch. A per-subscriber
   * suffix keeps each channel independent. The teardown still guards the
   * supabase-js "reuse an already-subscribed channel by name → .on() throws"
   * case for a single subscriber that remounts.
   */
  subscribe(orderId: string, cb: (o: Order) => void, subscriberKey = 'default'): () => void {
    const sb = getSupabase();
    const name = `order:${orderId}:status:${subscriberKey}`;
    // supabase-js returns an EXISTING channel if one with this name is still
    // registered. If a prior channel hasn't finished removeChannel() (async),
    // re-creating it here would hand back an already-subscribed channel, and
    // calling .on('postgres_changes') on it throws
    // "cannot add postgres_changes callbacks ... after subscribe()".
    // Tear down any stale same-named channel first so we always get a fresh one.
    for (const existing of sb.getChannels()) {
      if (existing.topic === `realtime:${name}`) sb.removeChannel(existing);
    }
    const channel = sb
      .channel(name)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'orders', filter: `id=eq.${orderId}` },
        (payload) => {
          cb(rowToOrder(payload.new as Parameters<typeof rowToOrder>[0]));
        },
      )
      .subscribe((status) => {
        // [H-CUST2] On (re)connect, refetch the order once. supabase-js rejoins
        // the channel after a network drop but does NOT replay events emitted
        // during the outage, so a status change while offline would be missed.
        // A one-shot fetch on SUBSCRIBED closes that gap (and the join-window
        // gap between the initial fetch and the first subscribe).
        if (status === 'SUBSCRIBED') {
          sb.from('orders')
            .select('*')
            .eq('id', orderId)
            .maybeSingle()
            .then(({ data }) => {
              if (data) cb(rowToOrder(data as Parameters<typeof rowToOrder>[0]));
            });
        }
      });
    return () => {
      sb.removeChannel(channel);
    };
  },

  /**
   * Subscribe to the driver's live GPS for an order via Realtime BROADCAST.
   * The driver app broadcasts {lat,lng,heading} on `order:{id}:driver_loc`.
   * Ephemeral — no DB writes. Only subscribe while the tracking screen is open.
   */
  subscribeDriverLocation(orderId: string, cb: (loc: DriverLocation) => void): () => void {
    const sb = getSupabase();
    const name = `order:${orderId}:driver_loc`;
    // Same channel-reuse guard as subscribe(): drop any stale same-named channel
    // so .on() is never called on an already-subscribed instance.
    for (const existing of sb.getChannels()) {
      if (existing.topic === `realtime:${name}`) sb.removeChannel(existing);
    }
    const channel = sb
      .channel(name, { config: { broadcast: { self: false } } })
      .on('broadcast', { event: 'loc' }, (msg) => {
        const p = msg.payload as DriverLocation;
        if (p && typeof p.lat === 'number' && typeof p.lng === 'number') cb(p);
      })
      .subscribe();
    return () => {
      sb.removeChannel(channel);
    };
  },

  /**
   * Debug-only "mark delivered" from the customer screen. In the REAL flow the
   * customer cannot force-deliver their own order (status advances via the
   * driver/merchant through advance_order_status, gated by RLS). We keep the
   * method to satisfy the shared repo interface, but it just re-reads the order
   * unchanged so the debug button is a harmless no-op against live data.
   */
  async forceDelivered(orderId: string): Promise<Order | null> {
    return this.get(orderId);
  },

  /** Customer-initiated cancel (only legal while 'placed' — enforced server-side). */
  async cancel(orderId: string, reason?: string): Promise<void> {
    const { error } = await getSupabase().rpc('advance_order_status', {
      p_order_id: orderId,
      p_new_status: 'cancelled',
      p_note: reason ?? null,
    });
    if (error) throw error;
  },

  async submitReview(
    orderId: string,
    ratingFood: number,
    ratingDelivery: number,
    comment: string,
  ): Promise<Order | null> {
    // Ratings are owner-updatable (legacy orders_owner_update_rating policy).
    const { data, error } = await getSupabase()
      .from('orders')
      .update({ rating_food: ratingFood, rating_delivery: ratingDelivery, rating_comment: comment })
      .eq('id', orderId)
      .select()
      .single();
    if (error) throw error;
    return data ? rowToOrder(data) : null;
  },
};

/** Turn RPC check_violation codes into friendly, user-facing errors. */
function mapPlaceOrderError(error: { message?: string }): Error {
  const msg = error.message ?? '';
  const map: Record<string, string> = {
    EMPTY_CART: 'Your cart is empty.',
    MERCHANT_CLOSED: 'This restaurant is currently closed.',
    MERCHANT_NOT_FOUND: 'Restaurant not found.',
    CASH_NOT_ACCEPTED: 'This restaurant does not accept cash on delivery.',
    CARD_NOT_ACCEPTED: 'This restaurant does not accept card payments.',
    ADDRESS_NOT_FOUND: 'Please choose a valid delivery address.',
    ITEM_NOT_FOUND: 'One of your items is no longer available.',
    ITEM_UNAVAILABLE: 'One of your items is currently unavailable.',
    BELOW_MIN_ORDER: 'Your order is below the restaurant minimum.',
    INVALID_QTY: 'Invalid item quantity.',
    AUTH_REQUIRED: 'Please sign in to place your order.',
    OUT_OF_RANGE: 'This restaurant is too far from your address to deliver. Try a closer restaurant or a different address.',
    USER_BLOCKED: 'Your account can’t place orders right now. Please contact support.',
    TOO_MANY_ACTIVE_ORDERS: 'You have too many orders in progress. Please wait for one to arrive first.',
    NEW_USER_ORDER_LIMIT: 'New accounts have a daily order limit. Please try again later.',
  };
  for (const key of Object.keys(map)) {
    if (msg.includes(key)) return new Error(map[key]);
  }
  return new Error(msg || 'Could not place your order. Please try again.');
}
