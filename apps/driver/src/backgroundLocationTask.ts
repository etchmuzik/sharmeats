import AsyncStorage from '@react-native-async-storage/async-storage';
import type { LocationObject } from 'expo-location';
import * as TaskManager from 'expo-task-manager';
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

interface LocationTaskData {
  locations?: LocationObject[];
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

async function handleLocationBatch(locations: LocationObject[]): Promise<void> {
  const orderId = await AsyncStorage.getItem(ACTIVE_ORDER_STORAGE_KEY);
  if (!orderId) return;

  const fix = latestValidFix(locations as RawLocationFix[]);
  if (!fix) return;

  const supabase = getSupabase();
  const { data: sessionData } = await supabase.auth.getSession();
  if (!sessionData.session) return;

  const now = Date.now();
  const lastPingAt = await readLastPingAt();
  const work: Promise<unknown>[] = [
    // Realtime is best-effort in the background. The database position remains
    // authoritative even if the OS briefly suspends the socket.
    broadcastLocation(orderId, toBroadcastPayload(fix)).catch(() => undefined),
  ];

  if (authoritativePingDue(lastPingAt, now)) {
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
