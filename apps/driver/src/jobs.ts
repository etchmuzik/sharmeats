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

export interface Job {
  id: string;
  short_code: string;
  restaurant_name: string;
  status: OrderStatus;
  payment_method: 'card' | 'cash_on_delivery';
  payment_status: 'pending' | 'paid' | 'failed' | 'refunded';
  total_egp: number;
  delivery_fee_egp: number;
  tip_egp: number;
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
  assigned_driver_id: string | null;
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
    .select(
      'id, short_code, restaurant_name, status, payment_method, payment_status, total_egp, delivery_fee_egp, tip_egp, address_snapshot, assigned_driver_id',
    )
    .eq('assigned_driver_id', driverId)
    .not('status', 'in', '(delivered,cancelled,rejected)')
    .order('placed_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return (data as Job) ?? null;
}

export async function fetchJob(orderId: string): Promise<Job | null> {
  const { data, error } = await getSupabase()
    .from('orders')
    .select(
      'id, short_code, restaurant_name, status, payment_method, payment_status, total_egp, delivery_fee_egp, tip_egp, address_snapshot, assigned_driver_id',
    )
    .eq('id', orderId)
    .maybeSingle();
  if (error) throw error;
  return (data as Job) ?? null;
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
