import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Location from 'expo-location';
import type { LocationObject } from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  authoritativePingDue,
  latestValidFix,
  toBroadcastPayload,
  type RawLocationFix,
} from './locationCore';
import { getSupabase } from './supabase';

export const DRIVER_LOCATION_TASK = 'sharmeats-active-delivery-location';
export const ACTIVE_ORDER_STORAGE_KEY = '@sharmeats/driver/active-order';
const LAST_PING_STORAGE_KEY = '@sharmeats/driver/last-authoritative-ping';
const REALTIME_CONNECT_TIMEOUT_MS = 5_000;

/** Statuses after which an order can never need live tracking again. */
const TERMINAL_STATUSES = ['delivered', 'cancelled', 'rejected'];

interface LocationTaskData {
  locations?: LocationObject[];
}

/**
 * Told when the task shuts itself down, so the foreground module can drop its
 * in-memory `active` stream. Without it `isStreaming()` would keep reporting
 * true after a self-termination and the idle heartbeat would skip every tick —
 * i.e. fixing the runaway stream would have broken the freshness ping.
 *
 * A callback rather than an import from location.ts: this module is imported BY
 * location.ts (it must be evaluated at bundle init so an OS-launched headless
 * task finds the definition), and the reverse import would be a cycle.
 */
let terminationListener: (() => void) | null = null;

export function onStreamTerminated(cb: (() => void) | null): void {
  terminationListener = cb;
}

async function readLastPingAt(): Promise<number | null> {
  const stored = await AsyncStorage.getItem(LAST_PING_STORAGE_KEY);
  if (!stored) return null;
  const value = Number(stored);
  return Number.isFinite(value) ? value : null;
}

async function broadcastLocation(
  orderId: string,
  payload: ReturnType<typeof toBroadcastPayload>,
): Promise<void> {
  const supabase = getSupabase();
  const channel = supabase.channel(`order:${orderId}:driver_loc`, {
    config: { broadcast: { self: false } },
  });

  try {
    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (!settled) {
          settled = true;
          reject(new Error('Realtime background broadcast timed out'));
        }
      }, REALTIME_CONNECT_TIMEOUT_MS);

      channel.subscribe((status) => {
        if (settled) return;
        if (status === 'SUBSCRIBED') {
          settled = true;
          clearTimeout(timer);
          resolve();
        } else if (
          status === 'CHANNEL_ERROR' ||
          status === 'TIMED_OUT' ||
          status === 'CLOSED'
        ) {
          settled = true;
          clearTimeout(timer);
          reject(new Error(`Realtime background broadcast failed: ${status}`));
        }
      });
    });
    await channel.send({ type: 'broadcast', event: 'loc', payload });
  } finally {
    await supabase.removeChannel(channel).catch(() => undefined);
  }
}

/**
 * Shut the background stream down from inside the task itself.
 *
 * `killServiceOnDestroy: false` deliberately keeps the foreground service alive
 * across an app kill so a delivery survives the driver swiping the app away —
 * but that also meant nothing could ever stop it: the task had no exit
 * condition, so a swiped-away app kept waking the GPS and broadcasting forever,
 * flattening the battery and publishing the driver's position long after the
 * delivery ended. This is the missing stop condition.
 */
async function terminateStream(): Promise<void> {
  await AsyncStorage.removeItem(ACTIVE_ORDER_STORAGE_KEY).catch(() => undefined);
  const started = await Location.hasStartedLocationUpdatesAsync(DRIVER_LOCATION_TASK).catch(
    () => false,
  );
  if (started) {
    await Location.stopLocationUpdatesAsync(DRIVER_LOCATION_TASK).catch(() => undefined);
  }
  terminationListener?.();
}

/**
 * Is this order still one that needs live tracking?
 *
 * Fails toward KEEPING the stream alive: a read error is a dead zone, and a
 * driver mid-delivery through a tunnel must not lose tracking for it. Only a
 * definite answer — a terminal status, or a row this driver can no longer see
 * because the order was reassigned away — stops the stream.
 */
async function orderStillLive(supabase: SupabaseClient, orderId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from('orders')
    .select('status')
    .eq('id', orderId)
    .maybeSingle();
  if (error) return true;
  if (!data) return false;
  return !TERMINAL_STATUSES.includes((data as { status?: string }).status ?? '');
}

async function handleLocationBatch(locations: LocationObject[]): Promise<void> {
  const orderId = await AsyncStorage.getItem(ACTIVE_ORDER_STORAGE_KEY);
  // No active order recorded: nothing to track, and the OS should stop waking us.
  if (!orderId) {
    await terminateStream();
    return;
  }

  const fix = latestValidFix(locations as RawLocationFix[]);
  if (!fix) return;

  const supabase = getSupabase();
  const { data: sessionData } = await supabase.auth.getSession();
  // Signed out: we can neither ping nor broadcast, so the stream is pure drain.
  if (!sessionData.session) {
    await terminateStream();
    return;
  }

  const now = Date.now();
  const lastPingAt = await readLastPingAt();
  const pingDue = authoritativePingDue(lastPingAt, now);

  // The liveness check rides the authoritative-ping cadence (~25s) rather than
  // running on every fix — one extra query per ping, not one per GPS sample.
  if (pingDue && !(await orderStillLive(supabase, orderId))) {
    await terminateStream();
    return;
  }

  const work: Promise<unknown>[] = [
    // Realtime is best-effort in the background. The database position remains
    // authoritative even if the OS briefly suspends the socket.
    broadcastLocation(orderId, toBroadcastPayload(fix)).catch(() => undefined),
  ];

  if (pingDue) {
    await AsyncStorage.setItem(LAST_PING_STORAGE_KEY, String(now));
    work.push(
      Promise.resolve(
        supabase.rpc('driver_ping', {
          p_lng: fix.coords.longitude,
          p_lat: fix.coords.latitude,
          p_status: '',
        }),
      ).catch(() => undefined),
    );
  }

  await Promise.all(work);
}

if (!TaskManager.isTaskDefined(DRIVER_LOCATION_TASK)) {
  TaskManager.defineTask<LocationTaskData>(DRIVER_LOCATION_TASK, async ({ data, error }) => {
    if (error || !Array.isArray(data?.locations) || data.locations.length === 0) return;
    await handleLocationBatch(data.locations);
  });
}
