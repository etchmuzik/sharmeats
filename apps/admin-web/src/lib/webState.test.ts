import { describe, expect, it } from 'vitest';

import {
  realtimeStatusAction,
  resolveAdminOnlyAccess,
  resolveOpsAccess,
  resolveOpsDashboardData,
  uniqueRealtimeChannelName,
} from './webState';

describe('admin web load state', () => {
  it('does not misrepresent a failed admin-only profile query as an authorization denial', () => {
    expect(resolveAdminOnlyAccess({ data: null, error: new Error('offline') })).toEqual({
      state: 'error',
    });
  });

  it('keeps a successful non-admin profile query as a real authorization denial', () => {
    expect(resolveAdminOnlyAccess({ data: { role: 'dispatcher', display_name: null }, error: null })).toEqual({
      state: 'unauthorized',
    });
  });

  it('does not misrepresent a failed profile query as an authorization denial', () => {
    expect(resolveOpsAccess({ data: null, error: new Error('offline') })).toEqual({
      state: 'error',
    });
  });

  it('distinguishes an authenticated but unauthorized role', () => {
    expect(resolveOpsAccess({ data: { role: 'customer', display_name: 'Guest' }, error: null })).toEqual({
      state: 'unauthorized',
    });
  });

  it('does not turn failed required dashboard queries into zero orders and zero drivers', () => {
    const result = resolveOpsDashboardData({
      orders: { data: null, error: new Error('orders failed') },
      drivers: { data: [], error: null },
      pingSetting: { data: null, error: null },
    });

    expect(result).toEqual({ state: 'error' });
  });

  it('keeps the documented ping-age fallback optional while required data succeeds', () => {
    const result = resolveOpsDashboardData({
      orders: { data: [{ id: 'order-1' }], error: null },
      drivers: { data: [{ id: 'driver-1' }], error: null },
      pingSetting: { data: null, error: new Error('setting not readable') },
    });

    expect(result).toMatchObject({
      state: 'ready',
      orders: [{ id: 'order-1' }],
      drivers: [{ id: 'driver-1' }],
    });
  });
});

describe('admin realtime lifecycle', () => {
  it('allocates a new physical channel name for every mount', () => {
    const first = uniqueRealtimeChannelName('ops:board');
    const second = uniqueRealtimeChannelName('ops:board');

    expect(first).not.toBe(second);
    expect(first).toMatch(/^ops:board:/);
    expect(second).toMatch(/^ops:board:/);
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
