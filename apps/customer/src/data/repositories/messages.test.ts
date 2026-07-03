import { describe, it, expect } from 'vitest';
import { messagesRepo } from './messages';

// The messages mock repo keeps an in-memory thread map keyed by orderId. Each
// test uses a distinct orderId so the module-level singleton state can't leak
// between cases.

describe('messagesRepo.list — a fresh order thread is empty', () => {
  it('returns [] for an order with no messages yet', async () => {
    const list = await messagesRepo.list('order-fresh');
    expect(Array.isArray(list)).toBe(true);
    expect(list).toEqual([]);
  });
});

describe('messagesRepo.send — appends a well-formed message', () => {
  it('creates a message with the right shape', async () => {
    const before = Date.now();
    const msg = await messagesRepo.send('order-send', '  hello there  ');
    const after = Date.now();

    expect(msg.orderId).toBe('order-send');
    expect(msg.senderRole).toBe('customer');
    expect(msg.senderId).toBe('me');
    expect(msg.body).toBe('hello there'); // trimmed
    expect(msg.readAt).toBeNull();
    expect(typeof msg.id).toBe('string');
    expect(msg.id.length).toBeGreaterThan(0);
    // createdAt is a real epoch stamped at send time.
    expect(msg.createdAt).toBeGreaterThanOrEqual(before);
    expect(msg.createdAt).toBeLessThanOrEqual(after);
  });

  it('appends the sent message to that order thread', async () => {
    await messagesRepo.send('order-append', 'first');
    await messagesRepo.send('order-append', 'second');
    const list = await messagesRepo.list('order-append');
    expect(list).toHaveLength(2);
    expect(list.map((m) => m.body)).toEqual(['first', 'second']);
  });

  it('keeps threads for different orders separate', async () => {
    await messagesRepo.send('order-A', 'to A');
    await messagesRepo.send('order-B', 'to B');
    const a = await messagesRepo.list('order-A');
    const b = await messagesRepo.list('order-B');
    expect(a).toHaveLength(1);
    expect(b).toHaveLength(1);
    expect(a[0].body).toBe('to A');
    expect(b[0].body).toBe('to B');
  });

  it('assigns unique ids to successive messages', async () => {
    const m1 = await messagesRepo.send('order-ids', 'one');
    const m2 = await messagesRepo.send('order-ids', 'two');
    expect(m1.id).not.toBe(m2.id);
  });
});

describe('messagesRepo.markRead — stamps readAt on the thread', () => {
  it('sets readAt on all unread messages in the thread', async () => {
    await messagesRepo.send('order-read', 'unread msg');
    const before = await messagesRepo.list('order-read');
    expect(before[0].readAt).toBeNull();

    await messagesRepo.markRead('order-read');

    const after = await messagesRepo.list('order-read');
    expect(after[0].readAt).not.toBeNull();
    expect(typeof after[0].readAt).toBe('number');
  });

  it('does not throw for an order with no messages', async () => {
    await expect(messagesRepo.markRead('order-none')).resolves.toBeUndefined();
  });
});

describe('messagesRepo.unreadCount — mock always reports 0', () => {
  it('returns 0', async () => {
    expect(await messagesRepo.unreadCount()).toBe(0);
  });
});

describe('messagesRepo.subscribe — returns a no-op unsubscribe', () => {
  it('returns a callable unsubscribe function that does not throw', () => {
    const unsub = messagesRepo.subscribe('order-sub', () => {});
    expect(typeof unsub).toBe('function');
    expect(() => unsub()).not.toThrow();
  });
});
