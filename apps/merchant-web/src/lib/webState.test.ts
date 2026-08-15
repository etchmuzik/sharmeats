import { describe, expect, it } from 'vitest';

import {
  realtimeStatusAction,
  resolveMerchantOrders,
  uniqueRealtimeChannelName,
} from './webState';

describe('merchant web load state', () => {
  it('does not misrepresent a failed initial queue query as waiting for orders', () => {
    expect(resolveMerchantOrders({ data: null, error: new Error('offline') })).toEqual({
      state: 'error',
    });
  });

  it('preserves a successful genuinely empty queue', () => {
    expect(resolveMerchantOrders({ data: [], error: null })).toEqual({
      state: 'ready',
      orders: [],
    });
  });
});

describe('merchant realtime lifecycle', () => {
  it('allocates a new physical channel name for every mount', () => {
    const first = uniqueRealtimeChannelName('merchant:restaurant-1:orders');
    const second = uniqueRealtimeChannelName('merchant:restaurant-1:orders');

    expect(first).not.toBe(second);
    expect(first).toMatch(/^merchant:restaurant-1:orders:/);
  });

  it('resyncs after every successful (re)subscription and exposes connection failures', () => {
    expect(realtimeStatusAction('SUBSCRIBED')).toBe('resync');
    expect(realtimeStatusAction('CHANNEL_ERROR')).toBe('reconnecting');
    expect(realtimeStatusAction('TIMED_OUT')).toBe('reconnecting');
  });

  it('treats CLOSED as terminal, because supabase-js never rejoins a closed channel', () => {
    // phx_close resets the rejoin timer and removes the channel from the
    // socket. Calling that "reconnecting" pins the UI to a banner that never
    // resolves AND hides the Retry control, which is the only way back.
    expect(realtimeStatusAction('CLOSED')).toBe('closed');
  });
});
