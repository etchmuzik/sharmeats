import type { RealtimeChannel } from '@supabase/supabase-js';
import { getSupabase } from './supabase';

/**
 * In-app order chat for the restaurant surface.
 *
 * Backed by the `order_messages` table + RPCs from migration 067. RLS lets any
 * order party (customer / assigned-driver / restaurant-staff) read and write a
 * thread, so the kitchen can reply to the customer or driver from the tablet.
 *
 * Writes go through `send_order_message` (server stamps sender_id + sender_role);
 * the client never trusts its own sender fields. Live updates arrive via
 * Realtime postgres_changes on `order_messages`, mirroring the order-queue
 * subscription pattern in orders.ts (tear down any stale same-named channel;
 * refetch the full thread on SUBSCRIBED to close the reconnect/join-window gap).
 */

export type MessageRole = 'customer' | 'driver' | 'restaurant';

export interface OrderMessage {
  id: string;
  order_id: string;
  sender_id: string;
  sender_role: MessageRole;
  body: string;
  created_at: string;
  read_at: string | null;
}

const MESSAGE_SELECT = 'id, order_id, sender_id, sender_role, body, created_at, read_at';

/** Full message thread for an order, oldest-first (chat order). */
export async function listMessages(orderId: string): Promise<OrderMessage[]> {
  const { data, error } = await getSupabase()
    .from('order_messages')
    .select(MESSAGE_SELECT)
    .eq('order_id', orderId)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data ?? []) as unknown as OrderMessage[];
}

/** Send a message on an order thread (server stamps sender_id + sender_role). */
export async function sendMessage(orderId: string, body: string): Promise<void> {
  const trimmed = body.trim();
  if (!trimmed) return;
  const { error } = await getSupabase().rpc('send_order_message', {
    p_order_id: orderId,
    p_body: trimmed,
  });
  if (error) throw error;
}

/** Mark every message the staffer hasn't sent as read (clears the unread badge). */
export async function markThreadRead(orderId: string): Promise<void> {
  const { error } = await getSupabase().rpc('mark_order_thread_read', {
    p_order_id: orderId,
  });
  if (error) throw error;
}

/** Count of unread messages across all of this staffer's order threads. */
export async function myUnreadMessageCount(): Promise<number> {
  const { data, error } = await getSupabase().rpc('my_unread_message_count');
  if (error) throw error;
  return typeof data === 'number' ? data : 0;
}

/**
 * Subscribe to new messages on an order thread. Returns an unsubscribe fn.
 * Tears down any stale same-named channel first (supabase-js reuses a channel by
 * name; calling .on() on an already-subscribed one throws), and refetches the
 * thread on (re)connect — supabase-js rejoins after a network drop but never
 * replays events emitted during the outage.
 */
export function subscribeMessages(
  orderId: string,
  onMessage: (row: OrderMessage) => void,
  onResync?: () => void,
): () => void {
  const sb = getSupabase();
  const name = `order:${orderId}:messages`;
  for (const existing of sb.getChannels()) {
    if (existing.topic === `realtime:${name}`) sb.removeChannel(existing);
  }
  const channel: RealtimeChannel = sb
    .channel(name)
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'order_messages', filter: `order_id=eq.${orderId}` },
      (payload) => {
        const row = payload.new as OrderMessage;
        if (row?.id) onMessage(row);
      },
    )
    .subscribe((status) => {
      if (status === 'SUBSCRIBED') onResync?.();
    });
  return () => {
    sb.removeChannel(channel);
  };
}
