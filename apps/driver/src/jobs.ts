/**
 * Driver jobs data layer. All status changes go through advance_order_status;
 * COD settlement through mark_cod_collected; offers via order_assignments.
 */
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

export interface JobItem {
  name: string;
  quantity?: number;
  notes?: string | null;
}

export interface Job {
  id: string;
  short_code: string;
  restaurant_name: string;
  status: OrderStatus;
  payment_method: 'card' | 'cash_on_delivery';
  payment_status: 'pending' | 'paid' | 'failed' | 'refunded';
  total_egp: number;
  subtotal_egp: number;
  delivery_fee_egp: number;
  tip_egp: number;
  /** Line items in the bag — lets the driver verify pickup. */
  items: JobItem[];
  /** Drop-off point as PostGIS EWKB hex (decode with parseWkbPoint). */
  dropoff_geo: string | null;
  /** Pickup point (restaurant) EWKB hex, joined from restaurants.geo. */
  restaurant_geo: string | null;
  address_snapshot: {
    kind?: string;
    label?: string;
    hotelName?: string;
    roomNumber?: string;
    streetText?: string;
    building?: string;
    apartment?: string;
    landmark?: string;
    beachName?: string;
    handoff?: string;
  };
  /** Customer contact phone (mig 028) — the driver calls this to complete delivery. */
  customer_phone: string | null;
  /** Per-order delivery/prep note from the customer. */
  kitchen_notes: string | null;
  /** Driver-facing handoff instruction (mig 041) — e.g. 'no_bell', 'leave_at_door'. */
  dropoff_preference: string | null;
  /** Optional free-text elaboration on dropoff_preference. */
  dropoff_note: string | null;
  assigned_driver_id: string | null;
}

/**
 * The order's address_snapshot is a verbatim copy of the snake_case `addresses`
 * row (place_order does to_jsonb), but the app reads camelCase. Without this the
 * driver's hotel name/room/street all render BLANK. Idempotent (reads camel first).
 */
function normalizeAddressSnapshot(raw: unknown): Job['address_snapshot'] {
  if (!raw || typeof raw !== 'object') return {};
  const a = raw as Record<string, unknown>;
  const pick = (camel: string, snake: string) => (a[camel] ?? a[snake]) as string | undefined;
  return {
    kind: pick('kind', 'kind'),
    label: pick('label', 'label'),
    hotelName: pick('hotelName', 'hotel_name'),
    roomNumber: pick('roomNumber', 'room_number'),
    streetText: pick('streetText', 'street_text'),
    building: pick('building', 'building'),
    apartment: pick('apartment', 'apartment'),
    landmark: pick('landmark', 'landmark'),
    beachName: pick('beachName', 'beach_name'),
    handoff: pick('handoff', 'handoff'),
  };
}

// Columns selected for a job. restaurants(geo) is a foreign-table join — the
// driver has RLS read access to their assigned order's restaurant.
const JOB_SELECT =
  'id, short_code, restaurant_name, status, payment_method, payment_status, ' +
  'total_egp, subtotal_egp, delivery_fee_egp, tip_egp, items, dropoff_geo, ' +
  'address_snapshot, customer_phone, kitchen_notes, dropoff_preference, dropoff_note, ' +
  'assigned_driver_id, restaurants(geo)';

/** Normalize a raw order row (with nested restaurants) into a Job. */
function toJob(row: Record<string, unknown> | null): Job | null {
  if (!row) return null;
  const rest = row.restaurants as { geo?: string } | { geo?: string }[] | null;
  const restaurant_geo = Array.isArray(rest) ? (rest[0]?.geo ?? null) : (rest?.geo ?? null);
  const rawItems = Array.isArray(row.items) ? row.items : [];
  const items: JobItem[] = rawItems.map((it: Record<string, unknown>) => ({
    name: String(it.name ?? 'Item'),
    quantity: typeof it.quantity === 'number' ? it.quantity : (it.qty as number | undefined),
    notes: (it.notes as string | null) ?? null,
  }));
  return {
    id: row.id as string,
    short_code: row.short_code as string,
    restaurant_name: row.restaurant_name as string,
    status: row.status as OrderStatus,
    payment_method: row.payment_method as Job['payment_method'],
    payment_status: row.payment_status as Job['payment_status'],
    total_egp: (row.total_egp as number) ?? 0,
    subtotal_egp: (row.subtotal_egp as number) ?? 0,
    delivery_fee_egp: (row.delivery_fee_egp as number) ?? 0,
    tip_egp: (row.tip_egp as number) ?? 0,
    items,
    dropoff_geo: (row.dropoff_geo as string | null) ?? null,
    restaurant_geo,
    address_snapshot: normalizeAddressSnapshot(row.address_snapshot),
    customer_phone: (row.customer_phone as string | null) ?? null,
    kitchen_notes: (row.kitchen_notes as string | null) ?? null,
    dropoff_preference: (row.dropoff_preference as string | null) ?? null,
    dropoff_note: (row.dropoff_note as string | null) ?? null,
    assigned_driver_id: (row.assigned_driver_id as string | null) ?? null,
  };
}

export interface Assignment {
  id: string;
  order_id: string;
  status: 'offered' | 'accepted' | 'rejected' | 'completed' | 'reassigned';
}

/** Distinguishes a genuinely-unlinked account from a transient fetch failure. */
export class DriverFetchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DriverFetchError';
  }
}

/**
 * The driver row for the current user.
 *   - returns the row when linked,
 *   - returns null when the account genuinely has no driver profile,
 *   - THROWS DriverFetchError on a query/network failure.
 * [H-BIZ1] Previously the query error was discarded and any failure looked like
 * "not a registered driver" — a dead-zone blip stranded a real driver on the
 * terminal "contact ops" screen. The caller now shows a retry state instead.
 */
export async function getMyDriver() {
  const sb = getSupabase();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) return null;
  const { data, error } = await sb
    .from('drivers')
    .select('id, name, status, vehicle, rating, is_verified')
    .eq('profile_id', user.id)
    .maybeSingle();
  if (error) throw new DriverFetchError(error.message);
  return data;
}

/** Set the driver's availability (online/offline). */
export async function setOnline(online: boolean): Promise<void> {
  const sb = getSupabase();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) throw new Error('Not authenticated');
  const { error } = await sb
    .from('drivers')
    .update({ status: online ? 'online' : 'offline' })
    .eq('profile_id', user.id);
  if (error) throw error;
}

/** Pending offers for this driver (status='offered'). */
export async function getOffers(driverId: string): Promise<Assignment[]> {
  const { data, error } = await getSupabase()
    .from('order_assignments')
    .select('id, order_id, status')
    .eq('driver_id', driverId)
    .eq('status', 'offered');
  if (error) throw error;
  return (data as Assignment[]) ?? [];
}

/**
 * Live subscription to this driver's offers via Realtime postgres_changes on
 * order_assignments. Previously the offer list refreshed only on screen-focus,
 * app-foreground, or a `new_offer` push tap — so a driver sitting on the home
 * screen with push disabled would not see a fresh offer until they manually
 * refocused. This makes an offer appear the instant dispatch creates the row,
 * independent of push.
 *
 * Fires `onChange` on every assignment change for this driver (INSERT of a new
 * offer, or an UPDATE that expires/reassigns one), and once on (re)connect —
 * supabase-js rejoins after a network drop but never replays missed events, so
 * a resync closes both the outage gap and the initial join-window gap. `onChange`
 * receives the current pending-offer list (refetched, so it's always consistent
 * with the DB rather than patched from a single row).
 *
 * Tears down any stale same-named channel first (supabase-js reuses a channel by
 * name; calling .on() on an already-subscribed one throws). Returns unsubscribe.
 */
export function subscribeOffers(
  driverId: string,
  onChange: (offers: Assignment[]) => void,
): () => void {
  const sb = getSupabase();
  const name = `driver:${driverId}:offers`;
  for (const existing of sb.getChannels()) {
    if (existing.topic === `realtime:${name}`) sb.removeChannel(existing);
  }
  const refresh = () => {
    getOffers(driverId).then(onChange).catch(() => {});
  };
  const channel = sb
    .channel(name)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'order_assignments', filter: `driver_id=eq.${driverId}` },
      () => refresh(),
    )
    .subscribe((status) => {
      if (status === 'SUBSCRIBED') refresh();
    });
  return () => {
    sb.removeChannel(channel);
  };
}

/**
 * The driver's current active order — one they have ACCEPTED and not finished.
 *
 * [H-DRV2] auto_assign_order/assign_driver set orders.assigned_driver_id at OFFER
 * time (before the driver accepts). Keying the active job off assigned_driver_id
 * alone made a merely-offered order show up as the black "Active delivery" card
 * (exposing the full address/phone pre-accept, letting the driver run the job
 * without accepting, and colliding with the sweep re-offering it to someone else
 * at TTL). We now require an ACCEPTED assignment: fetch the driver's accepted
 * order ids first, then load the newest non-terminal order among them.
 */
export async function getActiveJob(driverId: string): Promise<Job | null> {
  const sb = getSupabase();
  const { data: accepted, error: aErr } = await sb
    .from('order_assignments')
    .select('order_id')
    .eq('driver_id', driverId)
    .eq('status', 'accepted');
  if (aErr) throw aErr;
  const acceptedIds = (accepted ?? []).map((r) => (r as { order_id: string }).order_id);
  if (acceptedIds.length === 0) return null;

  const { data, error } = await sb
    .from('orders')
    .select(JOB_SELECT)
    .in('id', acceptedIds)
    .not('status', 'in', '(delivered,cancelled,rejected)')
    .order('placed_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return toJob(data as Record<string, unknown> | null);
}

export async function fetchJob(orderId: string): Promise<Job | null> {
  const { data, error } = await getSupabase()
    .from('orders')
    .select(JOB_SELECT)
    .eq('id', orderId)
    .maybeSingle();
  if (error) throw error;
  return toJob(data as Record<string, unknown> | null);
}

export async function respondToOffer(assignmentId: string, accept: boolean): Promise<void> {
  const { error } = await getSupabase().rpc('driver_respond', {
    p_assignment_id: assignmentId,
    p_accept: accept,
  });
  if (error) throw error;
}

export async function advance(orderId: string, next: OrderStatus): Promise<void> {
  const { error } = await getSupabase().rpc('advance_order_status', {
    p_order_id: orderId,
    p_new_status: next,
    p_note: null,
  });
  if (error) throw error;
}

export async function collectCod(orderId: string, amount: number): Promise<void> {
  const { error } = await getSupabase().rpc('mark_cod_collected', {
    p_order_id: orderId,
    p_amount: amount,
  });
  if (error) throw error;
}

export interface EarningsSummary {
  todayTotal: number;
  todayCount: number;
  todayTips: number;
  codOwed: number;
}

export async function getEarnings(driverId: string): Promise<EarningsSummary> {
  const since = new Date();
  since.setHours(0, 0, 0, 0);
  const { data, error } = await getSupabase()
    .from('driver_earnings')
    .select('total, tip, cod_collected, created_at')
    .eq('driver_id', driverId)
    .gte('created_at', since.toISOString());
  if (error) throw error;
  const rows = data ?? [];
  return {
    todayTotal: rows.reduce((s, r) => s + (r.total ?? 0), 0),
    todayCount: rows.length,
    todayTips: rows.reduce((s, r) => s + (r.tip ?? 0), 0),
    codOwed: rows.reduce((s, r) => s + (r.cod_collected ?? 0), 0),
  };
}

/** One past delivery, joined with its order for display. */
export interface DeliveryHistoryItem {
  id: string;
  order_id: string;
  short_code: string;
  restaurant_name: string;
  total: number;
  tip: number;
  created_at: string;
}

/**
 * The driver's completed deliveries, newest first. Reads driver_earnings (one
 * row per delivery) joined to the order for its short_code/restaurant. RLS
 * scopes driver_earnings to the owning driver.
 */
export async function getHistory(driverId: string, limit = 50): Promise<DeliveryHistoryItem[]> {
  const { data, error } = await getSupabase()
    .from('driver_earnings')
    .select('id, order_id, total, tip, created_at, orders(short_code, restaurant_name)')
    .eq('driver_id', driverId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []).map((row) => {
    const r = row as Record<string, unknown>;
    const ord = r.orders as { short_code?: string; restaurant_name?: string } | { short_code?: string; restaurant_name?: string }[] | null;
    const order = Array.isArray(ord) ? ord[0] : ord;
    return {
      id: r.id as string,
      order_id: r.order_id as string,
      short_code: order?.short_code ?? '—',
      restaurant_name: order?.restaurant_name ?? 'Restaurant',
      total: (r.total as number) ?? 0,
      tip: (r.tip as number) ?? 0,
      created_at: r.created_at as string,
    };
  });
}
