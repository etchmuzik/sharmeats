import { getSupabase } from './client';
import { tsToMs } from './mappers';
import type { OrderMessage } from '../types';

interface SupportRow {
  id: string;
  user_id: string;
  from_support: boolean;
  author_id: string | null;
  body: string;
  created_at: string;
  read_at: string | null;
}

// Reuse the OrderMessage shape; senderRole is 'admin' for support, 'customer' for the user.
// Timestamps go through tsToMs for the same Hermes reason as order messages:
// Realtime hands back the WAL timestamp form, which bare `new Date()` parses to
// NaN on device, so a live reply sorted to an arbitrary spot in the thread.
const rowToMessage = (r: SupportRow): OrderMessage => ({
  id: r.id,
  orderId: r.user_id, // support threads are keyed by user, not order
  senderId: r.author_id ?? r.user_id,
  senderRole: r.from_support ? 'admin' : 'customer',
  body: r.body,
  createdAt: tsToMs(r.created_at) ?? 0,
  readAt: r.read_at ? (tsToMs(r.read_at) ?? null) : null,
});

export const supportRepoSupabase = {
  async list(): Promise<OrderMessage[]> {
    const { data, error } = await getSupabase()
      .from('support_messages')
      .select('*')
      .order('created_at', { ascending: true });
    if (error) throw error;
    return (data ?? []).map((r) => rowToMessage(r as SupportRow));
  },

  async send(body: string): Promise<OrderMessage> {
    const { data, error } = await getSupabase().rpc('send_support_message', { p_body: body });
    if (error) throw error;
    return rowToMessage(data as SupportRow);
  },

  async markRead(): Promise<void> {
    const { error } = await getSupabase().rpc('mark_support_thread_read', { p_user_id: null });
    if (error) throw error;
  },

  async unreadCount(): Promise<number> {
    const { data, error } = await getSupabase().rpc('my_support_unread_count');
    if (error) throw error;
    return typeof data === 'number' ? data : 0;
  },

  subscribe(cb: (m: OrderMessage) => void): () => void {
    const sb = getSupabase();
    const name = 'support:self';
    for (const existing of sb.getChannels()) {
      if (existing.topic === `realtime:${name}`) sb.removeChannel(existing);
    }
    const channel = sb
      .channel(name)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'support_messages' }, (payload) => {
        cb(rowToMessage(payload.new as SupportRow));
      })
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          sb.from('support_messages')
            .select('*')
            .order('created_at', { ascending: true })
            .then(({ data }) => {
              for (const r of data ?? []) cb(rowToMessage(r as SupportRow));
            });
        }
      });
    return () => {
      sb.removeChannel(channel);
    };
  },
};
