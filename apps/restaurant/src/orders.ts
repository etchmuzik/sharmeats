import type { RealtimeChannel } from '@supabase/supabase-js';
import { getSupabase } from './supabase';
import { BUSY_DURATION_MINUTES } from './busyMode';

export type OrderStatus =
  | 'placed'
  | 'accepted'
  | 'preparing'
  | 'ready'
  | 'picked_up'
  | 'out_for_delivery'
  | 'delivered'
  | 'cancelled'
  | 'rejected';

export interface AddressSnapshot {
  kind?: 'hotel' | 'street' | 'beach_pin';
  label?: string;
  hotelName?: string;
  roomNumber?: string;
  handoff?: string;
  streetText?: string;
  building?: string;
  apartment?: string;
  landmark?: string;
  beachName?: string;
}

export interface OrderItem {
  name: string;
  quantity: number;
  modifierChoices?: { optionName?: string }[];
  notes?: string;
  allergens?: AllergenKey[];
  /**
   * This line cannot be dispensed without a valid prescription.
   *
   * Snapshotted onto orders.items at placement (mig 160), so it reflects what
   * was true when the customer ordered rather than what the catalog says now.
   *
   * Optional on purpose: orders placed before mig 160 carry no such key, and
   * must render as an ordinary line rather than as a false warning.
   */
  requiresPrescription?: boolean;
}

/** Structured allergen keys (mirrors the DB allergy_key_type enum, migration 003). */
export type AllergenKey =
  | 'nuts'
  | 'gluten'
  | 'dairy'
  | 'shellfish'
  | 'eggs'
  | 'soy'
  | 'spicy'
  | 'sesame';

/** Human-readable label for an allergen key, for the kitchen briefing banner. */
export function allergenLabel(key: AllergenKey): string {
  const labels: Record<AllergenKey, string> = {
    nuts: 'Nuts',
    gluten: 'Gluten',
    dairy: 'Dairy',
    shellfish: 'Shellfish',
    eggs: 'Eggs',
    soy: 'Soy',
    spicy: 'Spicy',
    sesame: 'Sesame',
  };
  return labels[key] ?? key;
}

export interface RestaurantOrder {
  id: string;
  short_code: string;
  restaurant_id: string;
  status: OrderStatus;
  payment_method: 'card' | 'cash_on_delivery';
  payment_status: 'pending' | 'paid' | 'failed' | 'refunded';
  fulfillment_type: 'platform' | 'self_delivery';
  total_egp: number;
  address_snapshot: AddressSnapshot | null;
  items: OrderItem[];
  kitchen_notes: string | null;
  scheduled_for: string | null;
  placed_at: string;
  // [H-REST2] Authoritative allergy briefing for the kitchen (food safety).
  aggregate_allergens: AllergenKey[] | null;
  // [H-REST2] Customer phone for the "Call customer" button (nullable).
  customer_phone: string | null;
}

export interface RestaurantContext {
  restaurantId: string;
  restaurantName: string;
  isOpen: boolean;
  staffRole: string;
}

/** One storefront this account staffs. A cloud kitchen runs several. */
export interface KitchenBrand {
  restaurantId: string;
  name: string;
  /** Uppercase short tag for the ticket chip, e.g. "SMASH". */
  shortName: string;
  isOpen: boolean;
  staffRole: string;
  /** [mig 186] When the current prep bump lapses; null = not busy. */
  busyUntil: string | null;
  /** [mig 186] Extra prep minutes applied while busyUntil is in the future. */
  busyExtraMinutes: number;
}

/**
 * Every storefront this account staffs.
 *
 * `isMultiBrand` is derived from cardinality, NOT from a user-facing toggle: a
 * mode someone forgets to switch on at 8pm on a Friday is a missed-ticket
 * generator. One brand renders exactly as before; two or more render the
 * combined queue.
 */
export interface KitchenContext {
  brands: KitchenBrand[];
  isMultiBrand: boolean;
}

/**
 * Short tag for a ticket chip. Colour must never be the only signal — kitchen
 * tablets are greasy and glare-washed — so this text chip is the primary
 * brand marker.
 */
export function brandShortName(name: string): string {
  const cleaned = name.trim();
  if (!cleaned) return '—';
  const words = cleaned.split(/\s+/);
  const pick = words.length > 1 ? words[words.length - 1] : words[0];
  return pick.slice(0, 8).toUpperCase();
}

const ORDER_SELECT =
  'id, short_code, restaurant_id, status, payment_method, payment_status, fulfillment_type,' +
  ' total_egp, address_snapshot, items, kitchen_notes, scheduled_for, placed_at,' +
  ' aggregate_allergens, customer_phone';

/**
 * place_order snapshots the original addresses row with to_jsonb(), so the
 * persisted keys are snake_case. The React Native UI uses camelCase. Normalize
 * every query and Realtime payload at this boundary so hotel/room/street details
 * do not silently render blank on the kitchen tablet.
 */
function normalizeAddressSnapshot(raw: unknown): AddressSnapshot | null {
  if (!raw || typeof raw !== 'object') return null;
  const address = raw as Record<string, unknown>;
  const pick = (camel: string, snake: string): string | undefined => {
    const value = address[camel] ?? address[snake];
    return typeof value === 'string' ? value : undefined;
  };
  return {
    kind: pick('kind', 'kind') as AddressSnapshot['kind'],
    label: pick('label', 'label'),
    hotelName: pick('hotelName', 'hotel_name'),
    roomNumber: pick('roomNumber', 'room_number'),
    handoff: pick('handoff', 'handoff'),
    streetText: pick('streetText', 'street_text'),
    building: pick('building', 'building'),
    apartment: pick('apartment', 'apartment'),
    landmark: pick('landmark', 'landmark'),
    beachName: pick('beachName', 'beach_name'),
  };
}

/** Normalize a database or Realtime row before it reaches restaurant UI. */
export function normalizeRestaurantOrder(row: Record<string, unknown>): RestaurantOrder {
  return {
    ...(row as unknown as RestaurantOrder),
    address_snapshot: normalizeAddressSnapshot(row.address_snapshot),
  };
}

/**
 * Resolve which restaurant this staffer belongs to (RLS-scoped via
 * merchant_staff). Mirrors the merchant-web dashboard's resolution.
 */
export async function getMyRestaurant(): Promise<RestaurantContext | null> {
  const kitchen = await getMyKitchen();
  if (!kitchen) return null;
  // Lowest restaurant_id, matching merchant-web's `.order('restaurant_id')
  // .limit(1)` resolution, so per-restaurant screens (menu, KYC) and the web
  // dashboard always operate on the SAME brand for a multi-brand account.
  const first = [...kitchen.brands].sort((a, b) =>
    a.restaurantId.localeCompare(b.restaurantId),
  )[0];
  return {
    restaurantId: first.restaurantId,
    restaurantName: first.name,
    isOpen: first.isOpen,
    staffRole: first.staffRole,
  };
}

type StaffRow = {
  restaurant_id: string;
  staff_role: string;
  restaurants: {
    name: string;
    is_open: boolean;
    busy_until: string | null;
    busy_extra_minutes: number | null;
  } | null;
};

/**
 * Resolve EVERY storefront this account staffs (RLS-scoped via merchant_staff).
 *
 * This previously did `.limit(1)` with no ORDER BY. With one row that is fine;
 * with five (a cloud kitchen running five virtual brands) Postgres returns an
 * ARBITRARY row that can differ between reloads — so four brands' tickets were
 * silently invisible and *which* brand you saw was nondeterministic. The
 * merchant_staff PK is (profile_id, restaurant_id), i.e. already many-to-many;
 * only the client capped it.
 *
 * Ordered by name so the brand list, chips and colours are stable across
 * reloads and across devices.
 */
export async function getMyKitchen(): Promise<KitchenContext | null> {
  const sb = getSupabase();
  const { data, error } = await sb
    .from('merchant_staff')
    .select(
      'restaurant_id, staff_role, restaurants(name, is_open, busy_until, busy_extra_minutes)',
    );
  if (error) throw error;

  // supabase-js infers the embedded `restaurants` join loosely (array/any); the
  // runtime shape is a single related row. Narrow via unknown to our known shape.
  const rows = (data ?? []) as unknown as StaffRow[];
  const brands: KitchenBrand[] = rows
    .map((row) => {
      const name = row.restaurants?.name ?? 'Your restaurant';
      return {
        restaurantId: row.restaurant_id,
        name,
        shortName: brandShortName(name),
        isOpen: row.restaurants?.is_open ?? false,
        staffRole: row.staff_role,
        busyUntil: row.restaurants?.busy_until ?? null,
        busyExtraMinutes: row.restaurants?.busy_extra_minutes ?? 0,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  if (brands.length === 0) return null;
  return { brands, isMultiBrand: brands.length > 1 };
}

/**
 * How far back the kitchen queue reaches.
 *
 * The query had no age bound at all, and prod had an order sitting in the
 * "ready" column for 238 hours. The queue is a picture of TONIGHT'S service: a
 * ticket that was never completed and never will be is not work, it is debris,
 * and it pushes live tickets off a counter tablet. 24h comfortably covers a
 * scheduled order placed the previous evening while excluding anything that has
 * plainly been abandoned. Abandoned orders are an OPS problem (admin-web
 * dispatch) — they are not fixed by leaving them on the pass forever.
 */
export const ACTIVE_ORDER_WINDOW_HOURS = 24;

/**
 * Hard cap on rows fetched, so a pathological backlog cannot make the tablet
 * render (and re-render on every Realtime event) an unbounded list.
 */
export const ACTIVE_ORDER_LIMIT = 200;

/** The oldest placed_at the queue will show, as an ISO timestamp. */
export function activeOrderSince(nowMs: number = Date.now()): string {
  return new Date(nowMs - ACTIVE_ORDER_WINDOW_HOURS * 60 * 60 * 1000).toISOString();
}

/**
 * Active orders across one or more storefronts (COD shows immediately; card
 * only once paid), bounded to the last ACTIVE_ORDER_WINDOW_HOURS.
 *
 * Accepts a single id or a list so a cloud kitchen sees ONE combined queue.
 * RLS already restricts the caller to their own restaurants, so `.in()` cannot
 * widen visibility.
 *
 * The fetch is ordered NEWEST-first and reversed here, which is not cosmetic:
 * with the cap applied to an oldest-first fetch, the rows dropped would be the
 * ones that just arrived — the queue would silently hide new orders under a
 * backlog, which is the exact failure this whole surface exists to prevent.
 * Callers still receive oldest-first, because the oldest live ticket is the
 * most urgent regardless of which brand it belongs to.
 */
export async function getActiveOrders(
  restaurantIds: string | string[],
): Promise<RestaurantOrder[]> {
  const ids = Array.isArray(restaurantIds) ? restaurantIds : [restaurantIds];
  if (ids.length === 0) return [];
  const { data, error } = await getSupabase()
    .from('orders')
    .select(ORDER_SELECT)
    .in('restaurant_id', ids)
    .not('status', 'in', '(delivered,cancelled,rejected)')
    .or('payment_method.eq.cash_on_delivery,payment_status.eq.paid')
    .gte('placed_at', activeOrderSince())
    .order('placed_at', { ascending: false })
    .limit(ACTIVE_ORDER_LIMIT);
  if (error) throw error;
  return (data ?? [])
    .map((row) => normalizeRestaurantOrder(row as unknown as Record<string, unknown>))
    .reverse();
}

/** Read a single order by id (RLS-scoped to the staffer's restaurant). */
export async function getOrder(orderId: string): Promise<RestaurantOrder | null> {
  const { data, error } = await getSupabase()
    .from('orders')
    .select(ORDER_SELECT)
    .eq('id', orderId)
    .maybeSingle();
  if (error) throw error;
  return data
    ? normalizeRestaurantOrder(data as unknown as Record<string, unknown>)
    : null;
}

/**
 * Subscribe to live order changes for a restaurant. Returns an unsubscribe fn.
 *
 * `subscriberKey` MUST be distinct per live subscriber. The home kiosk and an
 * open order-detail screen are both mounted at once (Expo Router pushes detail
 * over home) and both watch the SAME restaurant. If they shared a channel name,
 * the second subscriber's `removeChannel` teardown below would rip out the
 * first's live channel, and when detail later unmounts, ITS teardown would
 * leave zero channels — silently killing the kiosk's live feed and new-order
 * chime until a manual refresh (defeats the whole point of the repeat chime).
 * A per-subscriber suffix keeps the two channels independent. The same-named
 * teardown still guards the supabase-js "reuse an already-subscribed channel by
 * name → .on() throws" case for a single subscriber that remounts.
 */
export function subscribeOrders(
  restaurantId: string,
  subscriberKey: string,
  onChange: (row: RestaurantOrder) => void,
  onResync?: () => void,
  onLiveChange?: (live: boolean) => void,
): () => void {
  const sb = getSupabase();
  const name = `restaurant:${restaurantId}:orders:${subscriberKey}`;
  for (const existing of sb.getChannels()) {
    if (existing.topic === `realtime:${name}`) sb.removeChannel(existing);
  }
  const channel: RealtimeChannel = sb
    .channel(name)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'orders', filter: `restaurant_id=eq.${restaurantId}` },
      (payload) => {
        const raw = payload.new as Record<string, unknown>;
        if (raw?.id) onChange(normalizeRestaurantOrder(raw));
      },
    )
    .subscribe((status) => {
      // [H-CUST2] On (re)connect, ask the caller to refetch the active list.
      // supabase-js rejoins the channel after a network drop but never replays
      // events emitted during the outage — an order placed while offline would
      // otherwise never appear or chime. Also covers the join-window gap between
      // the initial load and the first SUBSCRIBED.
      if (status === 'SUBSCRIBED') {
        onResync?.();
        onLiveChange?.(true);
        return;
      }
      // A dead channel is the quietest failure this app has: no error surfaces,
      // no ticket arrives, and the kitchen reads the silence as "no orders".
      // Report it so the caller can say so out loud and fall back to polling.
      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
        onLiveChange?.(false);
      }
    });
  return () => {
    sb.removeChannel(channel);
  };
}

/**
 * Subscribe to live order changes for SEVERAL storefronts at once (a cloud
 * kitchen running multiple virtual brands).
 *
 * postgres_changes has no `in.(...)` filter, so this opens one channel per
 * brand — trivial at five — reusing subscribeOrders so the per-subscriber
 * channel-name discipline documented above carries over unchanged (the brand id
 * is already part of each channel name).
 *
 * `onResync` fires when ANY brand's channel (re)connects; callers should
 * refetch the whole combined list, which is exactly what they already do.
 *
 * `onLiveChange` reports the WEAKEST link: the combined feed is live only while
 * every brand's channel is. One dead channel means one brand's tickets stop
 * arriving, and a partial feed presented as healthy is the missed-order case.
 */
export function subscribeOrdersMulti(
  restaurantIds: string[],
  subscriberKey: string,
  onChange: (row: RestaurantOrder) => void,
  onResync?: () => void,
  onLiveChange?: (live: boolean) => void,
): () => void {
  const liveByBrand = new Map<string, boolean>(restaurantIds.map((id) => [id, true]));
  const unsubscribes = restaurantIds.map((id) =>
    subscribeOrders(id, subscriberKey, onChange, onResync, (live) => {
      liveByBrand.set(id, live);
      onLiveChange?.([...liveByBrand.values()].every(Boolean));
    }),
  );
  return () => {
    for (const unsubscribe of unsubscribes) unsubscribe();
  };
}

/** Advance an order via the server-authoritative state machine (merchant role). */
export async function advanceStatus(
  orderId: string,
  next: OrderStatus,
  note?: string,
): Promise<void> {
  const { error } = await getSupabase().rpc('advance_order_status', {
    p_order_id: orderId,
    p_new_status: next,
    p_note: note ?? null,
  });
  if (error) throw error;
}

/** Toggle the restaurant open/closed (RLS restaurants_merchant_update permits it). */
export async function setRestaurantOpen(restaurantId: string, open: boolean): Promise<void> {
  const { error } = await getSupabase()
    .from('restaurants')
    .update({ is_open: open })
    .eq('id', restaurantId);
  if (error) throw error;
}

/**
 * Set (or clear, with `extraMinutes = 0`) this brand's prep bump — mig 186.
 *
 * There is deliberately no direct UPDATE grant on restaurants.busy_until /
 * busy_extra_minutes; set_busy_mode is the only writer, it enforces manager+ on
 * the brand, and it bounds both the bump (5..60) and the window (15..240). The
 * client therefore validates nothing and invents nothing — a refusal comes back
 * as a PostgrestError and is surfaced, never swallowed.
 *
 * Returns the instant the bump lapses, or null when it was cleared.
 */
export async function setBusyMode(
  restaurantId: string,
  extraMinutes: number,
  durationMinutes: number = BUSY_DURATION_MINUTES,
): Promise<string | null> {
  const { data, error } = await getSupabase().rpc('set_busy_mode', {
    p_restaurant_id: restaurantId,
    p_extra_minutes: extraMinutes,
    p_duration_minutes: durationMinutes,
  });
  if (error) throw error;
  return (data as string | null) ?? null;
}

/**
 * Would this ticket still be inside the queue's age window?
 *
 * Realtime hands us whatever row changed, with no regard for the fetch's age
 * bound — an UPDATE on a long-abandoned order would otherwise resurrect it into
 * tonight's queue and undo the bound entirely.
 */
export function isWithinQueueWindow(
  placedAt: string,
  nowMs: number = Date.now(),
): boolean {
  const placedMs = new Date(placedAt).getTime();
  // An unparseable timestamp must NOT hide a ticket: OrderRow already treats
  // that case as "waiting since now" rather than dropping it.
  if (Number.isNaN(placedMs)) return true;
  return placedMs >= nowMs - ACTIVE_ORDER_WINDOW_HOURS * 60 * 60 * 1000;
}

/** Is this order still active (not terminal)? */
export function isActive(s: OrderStatus): boolean {
  return !['delivered', 'cancelled', 'rejected'].includes(s);
}

/** Is this order visible to the merchant yet (COD immediately; card once paid)? */
export function isVisible(o: Pick<RestaurantOrder, 'payment_method' | 'payment_status'>): boolean {
  return o.payment_method === 'cash_on_delivery' || o.payment_status === 'paid';
}
