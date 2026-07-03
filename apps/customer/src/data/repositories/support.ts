import type { OrderMessage } from '../types';

const delay = <T>(value: T, ms = 40): Promise<T> =>
  new Promise((resolve) => setTimeout(() => resolve(value), ms));

let thread: OrderMessage[] = [];
let seq = 0;

export const supportRepo = {
  async list(): Promise<OrderMessage[]> {
    return delay(thread);
  },
  async send(body: string): Promise<OrderMessage> {
    const msg: OrderMessage = {
      id: `s${++seq}`,
      orderId: 'support',
      senderId: 'me',
      senderRole: 'customer',
      body: body.trim(),
      createdAt: Date.now(),
      readAt: null,
    };
    thread = [...thread, msg];
    return delay(msg);
  },
  async markRead(): Promise<void> {
    return delay(undefined);
  },
  async unreadCount(): Promise<number> {
    return delay(0);
  },
  subscribe(_cb: (m: OrderMessage) => void): () => void {
    return () => {};
  },
};
