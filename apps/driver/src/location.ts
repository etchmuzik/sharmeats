/**
 * Driver location streaming — the live-tracking engine.
 *
 * Two outputs per GPS fix, by design (see the plan's live-tracking section):
 *   1. Realtime BROADCAST on `order:{id}:driver_loc` — ephemeral, no DB writes;
 *      the customer's tracking map subscribes to this for the live dot.
 *   2. A THROTTLED driver_ping RPC (~every 25s) updating drivers.current_geo —
 *      the authoritative position for dispatch (nearest_drivers) + admin board.
 *
 * Battery discipline: Accuracy.Balanced + ~25m distance interval, and we only
 * stream while on an ACTIVE delivery. Caller starts on pickup, stops on
 * delivered/handoff or when going offline.
 */
import * as Location from 'expo-location';
import { getSupabase } from './supabase';

const PING_INTERVAL_MS = 25_000; // throttle for the authoritative current_geo write
const DISTANCE_INTERVAL_M = 25; // emit a fix roughly every 25 meters of movement

interface ActiveStream {
  orderId: string;
  watcher: Location.LocationSubscription;
  channel: ReturnType<ReturnType<typeof getSupabase>['channel']>;
  lastPingAt: number;
}

let active: ActiveStream | null = null;

export async function requestLocationPermission(): Promise<boolean> {
  const { status } = await Location.requestForegroundPermissionsAsync();
  return status === 'granted';
}

/**
 * Start streaming this driver's location for an order. Broadcasts every fix to
 * the customer channel and throttles the authoritative current_geo write.
 */
export async function startStreaming(orderId: string): Promise<void> {
  if (active?.orderId === orderId) return; // already streaming this order
  await stopStreaming(); // ensure only one active stream

  const granted = await requestLocationPermission();
  if (!granted) throw new Error('Location permission denied');

  const sb = getSupabase();
  const channel = sb.channel(`order:${orderId}:driver_loc`);
  await new Promise<void>((resolve) => {
    channel.subscribe((status) => {
      if (status === 'SUBSCRIBED') resolve();
    });
  });

  const watcher = await Location.watchPositionAsync(
    {
      accuracy: Location.Accuracy.Balanced,
      distanceInterval: DISTANCE_INTERVAL_M,
      timeInterval: 5_000,
    },
    (pos) => {
      const { latitude, longitude, heading } = pos.coords;
      const now = Date.now();

      // 1) Broadcast the live dot (ephemeral, no DB write).
      channel
        .send({
          type: 'broadcast',
          event: 'loc',
          payload: { lat: latitude, lng: longitude, heading: heading ?? undefined, at: now },
        })
        .catch(() => {});

      // 2) Throttled authoritative write (dispatch/admin freshness).
      if (!active || now - active.lastPingAt >= PING_INTERVAL_MS) {
        if (active) active.lastPingAt = now;
        // Fire-and-forget; wrap so .catch exists (the RPC builder is thenable,
        // not a real Promise). A failed ping must not crash streaming.
        Promise.resolve(
          sb.rpc('driver_ping', { p_lng: longitude, p_lat: latitude, p_status: 'on_job' }),
        ).catch(() => {});
      }
    },
  );

  active = { orderId, watcher, channel, lastPingAt: 0 };
}

/** Stop streaming (on delivery handoff or going offline). */
export async function stopStreaming(): Promise<void> {
  if (!active) return;
  try {
    active.watcher.remove();
  } catch {
    /* ignore */
  }
  try {
    await getSupabase().removeChannel(active.channel);
  } catch {
    /* ignore */
  }
  active = null;
}

/** One-shot position push (e.g. when going online, to seed current_geo). */
export async function pingOnce(status?: 'online' | 'offline' | 'on_job'): Promise<void> {
  const granted = await requestLocationPermission();
  if (!granted) return;
  const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
  try {
    await getSupabase().rpc('driver_ping', {
      p_lng: pos.coords.longitude,
      p_lat: pos.coords.latitude,
      p_status: status ?? '',
    });
  } catch {
    /* fire-and-forget */
  }
}

export function isStreaming(orderId?: string): boolean {
  if (!active) return false;
  return orderId ? active.orderId === orderId : true;
}
