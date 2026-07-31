import { getSupabase } from './client';
import { tsToMs } from './mappers';
import type { MessageSenderRole, OrderMessage } from '../types';

interface MessageRow {
  id: string;
  order_id: string;
  sender_id: string;
  sender_role: MessageSenderRole;
  body: string;
  created_at: string;
  read_at: string | null;
}

// Timestamps go through tsToMs, NOT bare `new Date()`. Realtime
// postgres_changes delivers the raw WAL form ("2026-06-27 23:36:59+00") which
// Hermes' Date parser rejects — a live message then carried a NaN createdAt,
// which sorts unpredictably and rendered as an empty timestamp in the thread.
// See the helper's comment in mappers.ts.
const rowToMessage = (r: MessageRow): OrderMessage => ({
  id: r.id,
  orderId: r.order_id,
  senderId: r.sender_id,
  senderRole: r.sender_role,
  body: r.body,
  createdAt: tsToMs(r.created_at) ?? 0,
  readAt: r.read_at ? (tsToMs(r.read_at) ?? null) : null,
});

export const messagesRepoSupabase = {
  /** Full thread for an order, oldest first. */
  async list(orderId: string): Promise<OrderMessage[]> {
    const { data, error } = await getSupabase()
      .from('order_messages')
      .select('*')
      .eq('order_id', orderId)
      .order('created_at', { ascending: true });
    if (error) throw error;
    return (data ?? []).map((r) => rowToMessage(r as MessageRow));
  },

  /** Send a message; server stamps the sender's role. Returns the created row. */
  async send(orderId: string, body: string): Promise<OrderMessage> {
    const { data, error } = await getSupabase().rpc('send_order_message', {
      p_order_id: orderId,
      p_body: body,
    });
    if (error) throw error;
    return rowToMessage(data as MessageRow);
  },

  /** Mark all inbound messages on this thread as read (clears unread badge). */
  async markRead(orderId: string): Promise<void> {
    const { error } = await getSupabase().rpc('mark_order_thread_read', { p_order_id: orderId });
    if (error) throw error;
  },

  /** Total unread inbound messages across the caller's threads. */
  async unreadCount(): Promise<number> {
    const { data, error } = await getSupabase().rpc('my_unread_message_count');
    if (error) throw error;
    return typeof data === 'number' ? data : 0;
  },

  /**
   * Subscribe to new messages on an order thread (Realtime postgres_changes).
   * Mirrors ordersRepoSupabase.subscribe: tears down any stale same-named
   * channel first, and refetches once on (re)connect so no message is missed
   * during a network drop.
   */
  subscribe(orderId: string, cb: (m: OrderMessage) => void): () => void {
    const sb = getSupabase();
    const name = `order:${orderId}:messages`;
    for (const existing of sb.getChannels()) {
      if (existing.topic === `realtime:${name}`) sb.removeChannel(existing);
    }
    const channel = sb
      .channel(name)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'order_messages', filter: `order_id=eq.${orderId}` },
        (payload) => {
          cb(rowToMessage(payload.new as MessageRow));
        },
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          sb.from('order_messages')
            .select('*')
            .eq('order_id', orderId)
            .order('created_at', { ascending: true })
            .then(({ data }) => {
              for (const r of data ?? []) cb(rowToMessage(r as MessageRow));
            });
        }
      });
    return () => {
      sb.removeChannel(channel);
    };
  },
};
