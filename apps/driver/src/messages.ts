/**
 * Driver in-app chat data layer. Backed by the `order_messages` table + RPCs
 * (mig 067): send_order_message, mark_order_thread_read, my_unread_message_count.
 * RLS lets any order party (customer / assigned driver / restaurant staff)
 * read+write, so the driver reads and writes the same thread the customer sees.
 *
 * Mirrors the flat data-layer style of jobs.ts and the customer app's realtime
 * postgres_changes subscribe pattern (orders.ts): tear down any stale same-named
 * channel first, then refetch once on SUBSCRIBED to close the join-window /
 * reconnect gap.
 */
import { getSupabase } from './supabase';

/** A single chat message on an order thread. */
export interface OrderMessage {
  id: string;
  order_id: string;
  sender_id: string;
  sender_role: 'customer' | 'driver' | 'restaurant';
  body: string;
  created_at: string;
  read_at: string | null;
}

/** Normalize a raw order_messages row into an OrderMessage. */
function toMessage(row: Record<string, unknown> | null): OrderMessage | null {
  if (!row) return null;
  return {
    id: row.id as string,
    order_id: row.order_id as string,
    sender_id: row.sender_id as string,
    sender_role: row.sender_role as OrderMessage['sender_role'],
    body: String(row.body ?? ''),
    created_at: row.created_at as string,
    read_at: (row.read_at as string | null) ?? null,
  };
}

const MESSAGE_SELECT = 'id, order_id, sender_id, sender_role, body, created_at, read_at';

/** All messages on an order thread, oldest first. */
export async function list(orderId: string): Promise<OrderMessage[]> {
  const { data, error } = await getSupabase()
    .from('order_messages')
    .select(MESSAGE_SELECT)
    .eq('order_id', orderId)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data ?? [])
    .map((r) => toMessage(r as Record<string, unknown>))
    .filter((m): m is OrderMessage => m !== null);
}

/**
 * Send a message on the order thread. Goes through send_order_message so the
 * server stamps sender_id/sender_role from auth.uid() (the driver can't spoof
 * another party). Returns the inserted row when the RPC echoes it back.
 */
export async function send(orderId: string, body: string): Promise<OrderMessage | null> {
  const trimmed = body.trim();
  if (!trimmed) return null;
  const { data, error } = await getSupabase().rpc('send_order_message', {
    p_order_id: orderId,
    p_body: trimmed,
  });
  if (error) throw error;
  // The RPC may return the inserted row (single object) or nothing; be lenient.
  const row = Array.isArray(data) ? data[0] : data;
  return toMessage((row as Record<string, unknown> | null) ?? null);
}

/** Mark every message in this order's thread as read for the current user. */
export async function markRead(orderId: string): Promise<void> {
  const { error } = await getSupabase().rpc('mark_order_thread_read', {
    p_order_id: orderId,
  });
  if (error) throw error;
}

/** Count of unread messages across all the current user's order threads. */
export async function unreadCount(): Promise<number> {
  const { data, error } = await getSupabase().rpc('my_unread_message_count');
  if (error) throw error;
  return typeof data === 'number' ? data : 0;
}

/**
 * Subscribe to new messages on an order thread via Realtime postgres_changes.
 * Fires `cb` on every INSERT, and once with the full thread on SUBSCRIBED so a
 * reconnect (which supabase-js rejoins without replaying missed events) or the
 * initial join-window gap can't drop a message.
 *
 * Returns an unsubscribe function.
 */
export function subscribe(orderId: string, cb: (messages: OrderMessage[]) => void): () => void {
  const sb = getSupabase();
  const name = `order:${orderId}:messages`;
  // supabase-js hands back an EXISTING channel if one with this name is still
  // registered. If a prior channel hasn't finished removeChannel() (async),
  // re-creating it here would return an already-subscribed channel, and calling
  // .on('postgres_changes') on it throws "cannot add postgres_changes callbacks
  // ... after subscribe()". Drop any stale same-named channel first.
  for (const existing of sb.getChannels()) {
    if (existing.topic === `realtime:${name}`) sb.removeChannel(existing);
  }
  const channel = sb
    .channel(name)
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'order_messages', filter: `order_id=eq.${orderId}` },
      () => {
        // Refetch the whole thread rather than appending the single row: keeps
        // ordering correct and dedupes against an optimistic local echo.
        list(orderId).then(cb).catch(() => {});
      },
    )
    .subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        list(orderId).then(cb).catch(() => {});
      }
    });
  return () => {
    sb.removeChannel(channel);
  };
}
