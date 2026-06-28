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
  'address_snapshot, customer_phone, kitchen_notes, assigned_driver_id, restaurants(geo)';

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
    assigned_driver_id: (row.assigned_driver_id as string | null) ?? null,
  };
}

export interface Assignment {
  id: string;
  order_id: string;
  status: 'offered' | 'accepted' | 'rejected' | 'completed' | 'reassigned';
}

/** The driver row for the current user (null if not a driver / not linked). */
export async function getMyDriver() {
  const sb = getSupabase();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) return null;
  const { data } = await sb
    .from('drivers')
    .select('id, name, status, vehicle, rating, is_verified')
    .eq('profile_id', user.id)
    .maybeSingle();
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

/** The driver's current active order (assigned + not terminal). */
export async function getActiveJob(driverId: string): Promise<Job | null> {
  const { data, error } = await getSupabase()
    .from('orders')
    .select(JOB_SELECT)
    .eq('assigned_driver_id', driverId)
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
  codOwed: number;
}

export async function getEarnings(driverId: string): Promise<EarningsSummary> {
  const since = new Date();
  since.setHours(0, 0, 0, 0);
  const { data, error } = await getSupabase()
    .from('driver_earnings')
    .select('total, cod_collected, created_at')
    .eq('driver_id', driverId)
    .gte('created_at', since.toISOString());
  if (error) throw error;
  const rows = data ?? [];
  return {
    todayTotal: rows.reduce((s, r) => s + (r.total ?? 0), 0),
    todayCount: rows.length,
    codOwed: rows.reduce((s, r) => s + (r.cod_collected ?? 0), 0),
  };
}
