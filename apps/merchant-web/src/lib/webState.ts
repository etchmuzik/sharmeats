export interface QueryResult<T> {
  data: T | null;
  error: unknown | null;
}

export function resolveMerchantOrders<T>(result: QueryResult<T[]>):
  | { state: 'error' }
  | { state: 'ready'; orders: T[] } {
  if (result.error) return { state: 'error' };
  return { state: 'ready', orders: result.data ?? [] };
}

let fallbackChannelSequence = 0;

/**
 * Allocate a physical topic per effect mount. Supabase removes channels
 * asynchronously, so reusing a logical name immediately after cleanup can
 * return the previous already-subscribed channel and make .on() throw.
 */
export function uniqueRealtimeChannelName(logicalName: string): string {
  const suffix = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${++fallbackChannelSequence}`;
  return `${logicalName}:${suffix}`;
}

export type RealtimeStatusAction = 'resync' | 'reconnecting' | 'closed' | 'none';

export function realtimeStatusAction(status: string): RealtimeStatusAction {
  if (status === 'SUBSCRIBED') return 'resync';
  // CHANNEL_ERROR / TIMED_OUT schedule a rejoin inside supabase-js, so the
  // channel really is coming back.
  if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') return 'reconnecting';
  // CLOSED is TERMINAL: the phx_close hook resets the rejoin timer and removes
  // the channel from the socket, so nothing will ever rejoin it. Reporting it
  // as "reconnecting" leaves the operator watching a spinner forever, with the
  // Retry button (which recreates the channel) hidden.
  if (status === 'CLOSED') return 'closed';
  return 'none';
}
