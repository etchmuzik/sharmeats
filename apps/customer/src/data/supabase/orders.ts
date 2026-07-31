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
import { t } from '../../i18n';
import { withAllergenBriefing } from '../../lib/allergenBriefing';
import type {
  CartItem,
  Order,
  PaymentMethodKind,
  PreparedCart,
  PreparedCartIssue,
  PreparedCartLine,
} from '../types';
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
    // getUser() is a NETWORK call, and its error was being discarded — so a
    // flaky connection produced `user: null` and checkout failed with the
    // untranslated developer string "Not authenticated", telling a signed-in
    // customer to sign in. The two answers are different facts and get
    // different messages, both translated.
    const { data: auth, error: authError } = await sb.auth.getUser();
    if (authError) {
      const name = (authError as { name?: string }).name ?? '';
      const status = (authError as { status?: number }).status;
      // AuthSessionMissingError / 401 IS the answer "nobody is signed in".
      // Anything else means we could not find out, which is not the same thing.
      if (name !== 'AuthSessionMissingError' && status !== 401) {
        throw new Error(t('error.authUnavailable'));
      }
    }
    if (!auth?.user) throw new Error(t('error.authRequired'));

    // Server-authoritative creation. Client total/fee are IGNORED by the RPC.
    const { data, error } = await sb.rpc('place_order', {
      p_restaurant_id: input.restaurantId,
      p_address_id: input.address.id,
      p_cart: toCartPayload(input.items),
      p_payment_method: toPaymentMethod(input.payment.kind),
      p_tip: input.tipEgp ?? 0,
      // Allergens ride along with the note — see withAllergenBriefing. They were
      // being dropped entirely because place_order has no allergen parameter.
      p_kitchen_notes: withAllergenBriefing(input.kitchenNotes, input.aggregateAllergens),
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
    if (!row?.id) throw new Error(t('error.placeOrderFailed'));

    const order = await this.get(row.id as string);
    if (!order) throw new Error(t('error.placeOrderFailed'));
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

  /**
   * Is this restaurant actually willing to deliver to this address?
   *
   * This exists because `quoteDeliveryFee` CANNOT answer that question, despite
   * checkout having assumed it could. `quote_delivery_fee` resolves a zone and
   * returns a flat rule price — it never reads distance, `max_delivery_radius_m`
   * or `in_range`, and falls back to a flat 30 when no rule matches. So an
   * out-of-range address quoted successfully, the Place button unlocked, and the
   * rejection only arrived as OUT_OF_RANGE after the customer committed.
   *
   * `delivery_feasibility` is the only RPC that returns `in_range`, and it is the
   * same one `place_order` gates on, so asking it here means the button agrees
   * with the server instead of guessing.
   *
   * Note it FAILS OPEN by design (mig 186): a restaurant or address with no geo
   * yields `in_range = true` rather than blocking a real order on missing data.
   * We mirror that — an unreadable answer must never strand a deliverable order.
   */
  async checkDeliveryFeasibility(
    restaurantId: string,
    addressId: string,
  ): Promise<{ inRange: boolean; etaMinutes: number | null }> {
    const sb = getSupabase();
    const { data: addr, error: addrErr } = await sb
      .from('addresses')
      .select('geo')
      .eq('id', addressId)
      .maybeSingle();
    if (addrErr) throw addrErr;
    const { data, error } = await sb.rpc('delivery_feasibility', {
      p_restaurant_id: restaurantId,
      p_dropoff: addr?.geo ?? null,
    });
    if (error) throw error;
    // setof-returning RPC: PostgREST hands back an array of rows.
    const row = Array.isArray(data) ? data[0] : data;
    return {
      // Fail open, matching the SQL: only an explicit `false` blocks checkout.
      inRange: row?.in_range !== false,
      etaMinutes: typeof row?.eta_minutes === 'number' ? row.eta_minutes : null,
    };
  },

  /**
   * Reconcile a proposed cart against the CURRENT menu, server-side (mig 145).
   *
   * Sends identity only — item id, quantity, chosen option ids, notes — exactly
   * the shape `place_order` takes. Prices are deliberately NOT sent: the server
   * reads them, so a stale or tampered client price cannot influence anything.
   */
  async prepareCart(restaurantId: string, items: CartItem[]): Promise<PreparedCart> {
    const { data, error } = await getSupabase().rpc('prepare_cart', {
      p_restaurant_id: restaurantId,
      p_cart: items.map((i) => ({
        item_id: i.itemId,
        quantity: i.quantity,
        modifier_option_ids: i.modifierChoices.map((c) => c.optionId),
        notes: i.notes ?? null,
      })),
    });
    if (error) throw error;
    // The RPC RETURNS TABLE, so PostgREST delivers an array of one row.
    const row = Array.isArray(data) ? data[0] : data;
    if (!row) throw new Error('prepare_cart returned no row');
    return {
      restaurantId: row.restaurant_id,
      restaurantOpen: row.restaurant_open,
      minimumOrderEgp: row.minimum_order_egp ?? 0,
      lines: (row.prepared_items ?? []) as PreparedCartLine[],
      issues: (row.issues ?? []) as PreparedCartIssue[],
      subtotalEgp: row.subtotal_egp ?? 0,
    };
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
  /**
   * Mint (or return) a follow-my-order link for an order the caller placed.
   *
   * Idempotent server-side while unrevoked, so tapping Share twice cannot kill a
   * link already sitting in somebody's chat. See mig 195 for what the recipient
   * is and is not allowed to see.
   */
  async createShare(orderId: string): Promise<string> {
    const { data, error } = await getSupabase().rpc('create_order_share', {
      p_order_id: orderId,
    });
    if (error) throw error;
    return data as string;
  },

  async revokeShare(orderId: string): Promise<void> {
    const { error } = await getSupabase().rpc('revoke_order_share', {
      p_order_id: orderId,
    });
    if (error) throw error;
  },

  /** The live token for this order, or null when it is not being shared. */
  async getShareToken(orderId: string): Promise<string | null> {
    const { data, error } = await getSupabase()
      .from('order_shares')
      .select('token')
      .eq('order_id', orderId)
      .is('revoked_at', null)
      .maybeSingle();
    if (error) throw error;
    return (data?.token as string | undefined) ?? null;
  },

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

/** Turn RPC check_violation codes into friendly, localized user-facing errors. */
function mapPlaceOrderError(error: { message?: string }): Error {
  const msg = error.message ?? '';
  const map: Record<string, string> = {
    EMPTY_CART: 'error.emptyCart',
    MERCHANT_CLOSED: 'error.merchantClosed',
    MERCHANT_NOT_FOUND: 'error.merchantNotFound',
    CASH_NOT_ACCEPTED: 'error.cashNotAccepted',
    CARD_NOT_ACCEPTED: 'error.cardNotAccepted',
    ADDRESS_NOT_FOUND: 'error.addressNotFound',
    ITEM_NOT_FOUND: 'error.itemNotFound',
    ITEM_UNAVAILABLE: 'error.itemUnavailable',
    BELOW_MIN_ORDER: 'error.belowMinOrder',
    INVALID_QTY: 'error.invalidQty',
    AUTH_REQUIRED: 'error.authRequired',
    OUT_OF_RANGE: 'error.outOfRange',
    USER_BLOCKED: 'error.userBlocked',
    TOO_MANY_ACTIVE_ORDERS: 'error.tooManyActiveOrders',
    NEW_USER_ORDER_LIMIT: 'error.newUserOrderLimit',
  };
  for (const key of Object.keys(map)) {
    if (msg.includes(key)) return new Error(t(map[key]));
  }
  // NEVER fall back to the raw Postgres/PostgREST text. It is untranslated, it
  // names our schema, and it is meaningless to a customer — the honest message
  // for "something we did not anticipate" is the generic translated one. The
  // original is preserved as `cause` so Sentry still gets the diagnosis.
  const friendly = new Error(t('error.placeOrderFailed'));
  (friendly as Error & { cause?: unknown }).cause = msg;
  return friendly;
}
