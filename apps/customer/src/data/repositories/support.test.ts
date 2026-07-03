import { describe, it, expect } from 'vitest';
import { supportRepo } from './support';

// The support mock repo keeps a single in-memory thread (support is 1:1 with the
// user, not keyed by order). These tests share that thread, so send/list cases
// assert on relative growth rather than absolute contents.

describe('supportRepo.send — appends a well-formed support message', () => {
  it('creates a message with the right shape', async () => {
    const before = Date.now();
    const msg = await supportRepo.send('  need help  ');
    const after = Date.now();

    expect(msg.orderId).toBe('support');
    expect(msg.senderRole).toBe('customer');
    expect(msg.senderId).toBe('me');
    expect(msg.body).toBe('need help'); // trimmed
    expect(msg.readAt).toBeNull();
    expect(typeof msg.id).toBe('string');
    expect(msg.createdAt).toBeGreaterThanOrEqual(before);
    expect(msg.createdAt).toBeLessThanOrEqual(after);
  });

  it('grows the thread and list returns the sent messages', async () => {
    const startLen = (await supportRepo.list()).length;
    await supportRepo.send('one');
    await supportRepo.send('two');
    const list = await supportRepo.list();
    expect(list).toHaveLength(startLen + 2);
    // The two just-sent messages are the last two in the thread.
    expect(list.slice(-2).map((m) => m.body)).toEqual(['one', 'two']);
  });

  it('assigns unique ids to successive messages', async () => {
    const m1 = await supportRepo.send('a');
    const m2 = await supportRepo.send('b');
    expect(m1.id).not.toBe(m2.id);
  });
});

describe('supportRepo.list — returns the thread as an array', () => {
  it('returns an array', async () => {
    const list = await supportRepo.list();
    expect(Array.isArray(list)).toBe(true);
  });
});

describe('supportRepo.markRead — resolves without throwing', () => {
  it('resolves to undefined', async () => {
    await expect(supportRepo.markRead()).resolves.toBeUndefined();
  });
});

describe('supportRepo.unreadCount — mock always reports 0', () => {
  it('returns 0', async () => {
    expect(await supportRepo.unreadCount()).toBe(0);
  });
});

describe('supportRepo.subscribe — returns a no-op unsubscribe', () => {
  it('returns a callable unsubscribe function that does not throw', () => {
    const unsub = supportRepo.subscribe(() => {});
    expect(typeof unsub).toBe('function');
    expect(() => unsub()).not.toThrow();
  });
});
