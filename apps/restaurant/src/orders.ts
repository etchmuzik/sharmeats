import type { RealtimeChannel } from '@supabase/supabase-js';
import { getSupabase } from './supabase';

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

const ORDER_SELECT =
  'id, short_code, restaurant_id, status, payment_method, payment_status, fulfillment_type,' +
  ' total_egp, address_snapshot, items, kitchen_notes, scheduled_for, placed_at,' +
  ' aggregate_allergens, customer_phone';

/**
 * Resolve which restaurant this staffer belongs to (RLS-scoped via
 * merchant_staff). Mirrors the merchant-web dashboard's resolution.
 */
export async function getMyRestaurant(): Promise<RestaurantContext | null> {
  const sb = getSupabase();
  const { data, error } = await sb
    .from('merchant_staff')
    .select('restaurant_id, staff_role, restaurants(name, is_open)')
    .limit(1);
  if (error) throw error;
  // supabase-js infers the embedded `restaurants` join loosely (array/any); the
  // runtime shape is a single related row. Narrow via unknown to our known shape.
  const staff = data?.[0] as unknown as
    | { restaurant_id: string; staff_role: string; restaurants: { name: string; is_open: boolean } | null }
    | undefined;
  if (!staff) return null;
  return {
    restaurantId: staff.restaurant_id,
    restaurantName: staff.restaurants?.name ?? 'Your restaurant',
    isOpen: staff.restaurants?.is_open ?? false,
    staffRole: staff.staff_role,
  };
}

/** Active orders for a restaurant (COD shows immediately; card only once paid). */
export async function getActiveOrders(restaurantId: string): Promise<RestaurantOrder[]> {
  const { data, error } = await getSupabase()
    .from('orders')
    .select(ORDER_SELECT)
    .eq('restaurant_id', restaurantId)
    .not('status', 'in', '(delivered,cancelled,rejected)')
    .or('payment_method.eq.cash_on_delivery,payment_status.eq.paid')
    .order('placed_at', { ascending: true });
  if (error) throw error;
  return (data ?? []) as unknown as RestaurantOrder[];
}

/** Read a single order by id (RLS-scoped to the staffer's restaurant). */
export async function getOrder(orderId: string): Promise<RestaurantOrder | null> {
  const { data, error } = await getSupabase()
    .from('orders')
    .select(ORDER_SELECT)
    .eq('id', orderId)
    .maybeSingle();
  if (error) throw error;
  return (data as unknown as RestaurantOrder) ?? null;
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
        const row = payload.new as RestaurantOrder;
        if (row?.id) onChange(row);
      },
    )
    .subscribe((status) => {
      // [H-CUST2] On (re)connect, ask the caller to refetch the active list.
      // supabase-js rejoins the channel after a network drop but never replays
      // events emitted during the outage — an order placed while offline would
      // otherwise never appear or chime. Also covers the join-window gap between
      // the initial load and the first SUBSCRIBED.
      if (status === 'SUBSCRIBED') onResync?.();
    });
  return () => {
    sb.removeChannel(channel);
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

/** Is this order still active (not terminal)? */
export function isActive(s: OrderStatus): boolean {
  return !['delivered', 'cancelled', 'rejected'].includes(s);
}

/** Is this order visible to the merchant yet (COD immediately; card once paid)? */
export function isVisible(o: Pick<RestaurantOrder, 'payment_method' | 'payment_status'>): boolean {
  return o.payment_method === 'cash_on_delivery' || o.payment_status === 'paid';
}
