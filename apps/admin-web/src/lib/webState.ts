import { DEFAULT_MAX_PING_AGE_SECONDS } from './dispatch';

export interface QueryResult<T> {
  data: T | null;
  error: unknown | null;
}

interface OpsProfile {
  role: string | null;
  display_name: string | null;
}

export type OpsAccessResult =
  | { state: 'error' }
  | { state: 'unauthorized' }
  | { state: 'allowed'; role: 'admin' | 'dispatcher'; displayName: string };

export type AdminOnlyAccessResult =
  | { state: 'error' }
  | { state: 'unauthorized' }
  | { state: 'allowed'; displayName: string };

export function resolveAdminOnlyAccess(result: QueryResult<OpsProfile>): AdminOnlyAccessResult {
  if (result.error) return { state: 'error' };
  if (result.data?.role !== 'admin') return { state: 'unauthorized' };
  return { state: 'allowed', displayName: result.data.display_name ?? 'Admin' };
}

export function resolveOpsAccess(result: QueryResult<OpsProfile>): OpsAccessResult {
  if (result.error) return { state: 'error' };
  const role = result.data?.role;
  if (role !== 'admin' && role !== 'dispatcher') return { state: 'unauthorized' };
  return {
    state: 'allowed',
    role,
    displayName: result.data?.display_name ?? role,
  };
}

export function resolveOpsDashboardData<TOrder, TDriver>(results: {
  orders: QueryResult<TOrder[]>;
  drivers: QueryResult<TDriver[]>;
  pingSetting: QueryResult<{ value: unknown }>;
}):
  | { state: 'error' }
  | {
      state: 'ready';
      orders: TOrder[];
      drivers: TDriver[];
      maxPingAgeSeconds: number;
    } {
  if (results.orders.error || results.drivers.error) return { state: 'error' };

  const setting = results.pingSetting.data?.value;
  return {
    state: 'ready',
    orders: results.orders.data ?? [],
    drivers: results.drivers.data ?? [],
    maxPingAgeSeconds:
      typeof setting === 'number' && Number.isFinite(setting) && setting > 0
        ? setting
        : DEFAULT_MAX_PING_AGE_SECONDS,
  };
}

let fallbackChannelSequence = 0;

/**
 * A physical Realtime topic must never be reused across React effect mounts.
 * removeChannel() is asynchronous, so "remove then immediately recreate the
 * same name" can still return the old subscribed channel and make .on() throw.
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
