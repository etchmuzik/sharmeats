import type { OrderMessage } from '../types';

const delay = <T>(value: T, ms = 40): Promise<T> =>
  new Promise((resolve) => setTimeout(() => resolve(value), ms));

// In-memory demo threads keyed by orderId.
const threads: Record<string, OrderMessage[]> = {};
let seq = 0;

export const messagesRepo = {
  async list(orderId: string): Promise<OrderMessage[]> {
    return delay(threads[orderId] ?? []);
  },
  async send(orderId: string, body: string): Promise<OrderMessage> {
    const msg: OrderMessage = {
      id: `m${++seq}`,
      orderId,
      senderId: 'me',
      senderRole: 'customer',
      body: body.trim(),
      createdAt: Date.now(),
      readAt: null,
    };
    threads[orderId] = [...(threads[orderId] ?? []), msg];
    return delay(msg);
  },
  async markRead(orderId: string): Promise<void> {
    threads[orderId] = (threads[orderId] ?? []).map((m) => ({ ...m, readAt: m.readAt ?? Date.now() }));
    return delay(undefined);
  },
  async unreadCount(): Promise<number> {
    return delay(0);
  },
  subscribe(_orderId: string, _cb: (m: OrderMessage) => void): () => void {
    return () => {};
  },
};
