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
  /** Whether the Realtime channel is currently live (drives the live dot). */
  connected: boolean;
}

let active: ActiveStream | null = null;

/** Connection-health states the caller (UI) can react to. */
export type StreamHealth = 'connected' | 'reconnecting' | 'disconnected';
let healthListener: ((h: StreamHealth) => void) | null = null;

/** Subscribe to live-stream connection health so the UI can warn the driver. */
export function onStreamHealth(cb: ((h: StreamHealth) => void) | null): void {
  healthListener = cb;
}
function emitHealth(h: StreamHealth): void {
  if (active) active.connected = h === 'connected';
  healthListener?.(h);
}

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

  // Resolve on first SUBSCRIBED; reject if the initial connect errors or times
  // out (so the caller surfaces a real failure instead of hanging forever).
  // After the initial connect, later CHANNEL_ERROR/CLOSED/TIMED_OUT events while
  // we're still the active stream trigger a re-subscribe so the customer's live
  // dot self-heals. The authoritative driver_ping write is a direct RPC and
  // keeps working regardless, so dispatch never loses the driver.
  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        reject(new Error('Live-tracking channel timed out'));
      }
    }, 10_000);

    channel.subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        emitHealth('connected');
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          resolve();
        }
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
        if (!settled) {
          // Initial connect failed.
          settled = true;
          clearTimeout(timer);
          reject(new Error(`Live-tracking channel failed: ${status}`));
        } else if (active && active.orderId === orderId) {
          // Mid-stream drop — surface it and let supabase-js auto-rejoin.
          emitHealth('reconnecting');
        }
      }
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

  active = { orderId, watcher, channel, lastPingAt: 0, connected: true };
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
  emitHealth('disconnected');
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
