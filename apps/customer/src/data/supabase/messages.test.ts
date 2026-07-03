import { describe, it, expect, vi } from 'vitest';

// rowToMessage is module-private in messages.ts (not exported — and we must not
// export it just for tests). We exercise it through the public repo surface
// instead: mock ./client so getSupabase() returns a fake query builder, then the
// real rowToMessage runs on the rows we feed back. This tests the mapper logic
// (snake_case → camelCase, created_at string → epoch, read_at null handling)
// with no live backend — mirroring the vi.mock module-stub pattern used in
// store/cart.test.ts and components/DropoffPreferenceCard.test.ts.

// Holds the rows the fake `.order()` resolves with for a given test.
let listRows: unknown[] = [];
// Holds the single row the fake `.rpc('send_order_message')` resolves with.
let sendRow: unknown = null;
// Holds the value the fake `.rpc('my_unread_message_count')` resolves with.
let unreadValue: unknown = 0;

vi.mock('./client', () => ({
  getSupabase: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          order: () => Promise.resolve({ data: listRows, error: null }),
        }),
      }),
    }),
    rpc: (name: string) => {
      if (name === 'send_order_message') return Promise.resolve({ data: sendRow, error: null });
      if (name === 'my_unread_message_count') return Promise.resolve({ data: unreadValue, error: null });
      return Promise.resolve({ data: null, error: null });
    },
  }),
}));

import { messagesRepoSupabase } from './messages';

const baseRow = {
  id: 'msg-1',
  order_id: 'order-9',
  sender_id: 'user-7',
  sender_role: 'driver',
  body: 'On my way',
  created_at: '2026-07-01T12:00:00+00:00',
  read_at: null,
};

describe('rowToMessage (via list) — snake_case → camelCase mapping', () => {
  it('maps a DB row to the OrderMessage shape', async () => {
    listRows = [baseRow];
    const [m] = await messagesRepoSupabase.list('order-9');
    expect(m.id).toBe('msg-1');
    expect(m.orderId).toBe('order-9');
    expect(m.senderId).toBe('user-7');
    expect(m.senderRole).toBe('driver');
    expect(m.body).toBe('On my way');
  });

  it('parses created_at (ISO string) to an epoch number', async () => {
    listRows = [baseRow];
    const [m] = await messagesRepoSupabase.list('order-9');
    expect(typeof m.createdAt).toBe('number');
    expect(Number.isNaN(m.createdAt)).toBe(false);
    expect(m.createdAt).toBe(new Date('2026-07-01T12:00:00+00:00').getTime());
  });

  it('maps read_at null to readAt null', async () => {
    listRows = [{ ...baseRow, read_at: null }];
    const [m] = await messagesRepoSupabase.list('order-9');
    expect(m.readAt).toBeNull();
  });

  it('parses a non-null read_at to an epoch number', async () => {
    listRows = [{ ...baseRow, read_at: '2026-07-01T12:05:00+00:00' }];
    const [m] = await messagesRepoSupabase.list('order-9');
    expect(typeof m.readAt).toBe('number');
    expect(m.readAt).toBe(new Date('2026-07-01T12:05:00+00:00').getTime());
  });

  it('returns [] when the query yields no rows (null data guard)', async () => {
    listRows = [];
    const list = await messagesRepoSupabase.list('order-9');
    expect(list).toEqual([]);
  });
});

describe('rowToMessage (via send) — RPC result mapping', () => {
  it('maps the created row returned by send_order_message', async () => {
    sendRow = { ...baseRow, id: 'msg-2', sender_role: 'customer', body: 'Thanks!' };
    const m = await messagesRepoSupabase.send('order-9', 'Thanks!');
    expect(m.id).toBe('msg-2');
    expect(m.senderRole).toBe('customer');
    expect(m.body).toBe('Thanks!');
    expect(typeof m.createdAt).toBe('number');
  });
});

describe('unreadCount — coerces non-number RPC results to 0', () => {
  it('returns the numeric count when the RPC yields a number', async () => {
    unreadValue = 3;
    expect(await messagesRepoSupabase.unreadCount()).toBe(3);
  });

  it('returns 0 when the RPC yields null', async () => {
    unreadValue = null;
    expect(await messagesRepoSupabase.unreadCount()).toBe(0);
  });
});
