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
 * stream while on an ACTIVE delivery. Expo Task Manager keeps the job alive in
 * the background; the active order id is persisted for an OS-launched task.
 */
import * as Location from 'expo-location';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  ACTIVE_ORDER_STORAGE_KEY,
  DRIVER_LOCATION_TASK,
} from './backgroundLocationTask';
import { getSupabase } from './supabase';
import {
  DRIVER_LOCALE_STORAGE_KEY,
  trackingNotificationCopy,
} from './i18n';

const DISTANCE_INTERVAL_M = 25; // emit a fix roughly every 25 meters of movement

interface ActiveStream {
  orderId: string;
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
 * Start background-capable streaming for an active order. The task definition
 * is imported at bundle initialization, which is required when the OS launches
 * the app headlessly for a location update.
 */
export async function startStreaming(orderId: string): Promise<void> {
  const normalizedOrderId = orderId.trim();
  if (!normalizedOrderId) throw new Error('Order id is required for live tracking');
  if (
    active?.orderId === normalizedOrderId &&
    (await Location.hasStartedLocationUpdatesAsync(DRIVER_LOCATION_TASK))
  ) {
    return;
  }
  await stopStreaming(); // ensure only one active stream

  const granted = await requestLocationPermission();
  if (!granted) throw new Error('Location permission denied');

  const background = await Location.requestBackgroundPermissionsAsync();
  if (background.status !== 'granted') {
    throw new Error(
      'Background location is required during an active delivery. Allow location all the time in Settings.',
    );
  }

  // This code can run while React is not mounted, so it deliberately reads the
  // same persisted locale as LanguageProvider instead of using a hook. Falling
  // back to English keeps Android's required foreground-service notification
  // available even if storage is temporarily inaccessible.
  const storedLocale = await AsyncStorage.getItem(DRIVER_LOCALE_STORAGE_KEY).catch(
    () => null,
  );
  const notification = trackingNotificationCopy(storedLocale);

  await AsyncStorage.setItem(ACTIVE_ORDER_STORAGE_KEY, normalizedOrderId);
  try {
    await Location.startLocationUpdatesAsync(DRIVER_LOCATION_TASK, {
      accuracy: Location.Accuracy.Balanced,
      distanceInterval: DISTANCE_INTERVAL_M,
      timeInterval: 5_000,
      deferredUpdatesDistance: DISTANCE_INTERVAL_M,
      deferredUpdatesInterval: 5_000,
      activityType: Location.ActivityType.AutomotiveNavigation,
      pausesUpdatesAutomatically: false,
      showsBackgroundLocationIndicator: true,
      foregroundService: {
        notificationTitle: notification.title,
        notificationBody: notification.body,
        notificationColor: '#0E7C91',
        killServiceOnDestroy: false,
      },
    });
  } catch (error) {
    await AsyncStorage.removeItem(ACTIVE_ORDER_STORAGE_KEY);
    throw error;
  }

  active = { orderId: normalizedOrderId, connected: true };
  emitHealth('connected');
  await pingOnce();
}

/** Stop streaming (on delivery handoff or going offline). */
export async function stopStreaming(): Promise<void> {
  const started = await Location.hasStartedLocationUpdatesAsync(DRIVER_LOCATION_TASK).catch(
    () => false,
  );
  if (started) {
    await Location.stopLocationUpdatesAsync(DRIVER_LOCATION_TASK);
  }
  await AsyncStorage.removeItem(ACTIVE_ORDER_STORAGE_KEY);
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

/**
 * IDLE HEARTBEAT — the client half of migration 201.
 *
 * Mig 201 made `nearest_drivers` require a ping newer than
 * platform_settings.dispatch_max_ping_age_seconds (default 300s): status is
 * intent and survives a force-quit, `last_ping_at` is evidence. That was the
 * right call — seed drivers marked online since June were being re-dispatched
 * thousands of times to phones that were not listening.
 *
 * But nothing ever sent that evidence while a driver was WAITING. driver_ping
 * fired only on the online/offline toggle, on a foreground transition, and from
 * the background task — which returns early unless an active delivery is
 * streaming. So an online driver between jobs, phone pocketed, stopped
 * satisfying the filter 5 minutes later and silently left the dispatch pool.
 *
 * That deadlocks: no candidate -> no offer row -> no push -> nothing wakes the
 * driver, who is waiting for exactly that push. The 2026-07-31 audit rated it
 * P0 for that reason.
 *
 * INTERVAL: 120s against a 300s window gives two missed beats of slack before a
 * driver drops out, so a single failed request or a brief radio gap does not
 * cost them offers. Cheap: one small RPC per two minutes per online driver.
 *
 * BATTERY: this is deliberately NOT a location subscription. It takes a single
 * Balanced-accuracy fix per beat — the same thing the foreground transition
 * already did — and does nothing at all while streaming, because an active
 * delivery is already pinging on its own.
 */
const IDLE_HEARTBEAT_MS = 120_000;

let heartbeat: ReturnType<typeof setInterval> | null = null;

export function startIdleHeartbeat(): void {
  if (heartbeat) return;  // already beating; never stack two
  heartbeat = setInterval(() => {
    // While streaming, the location task's throttled ping is the fresher
    // signal — beating on top of it would be redundant GPS work.
    if (isStreaming()) return;
    // [215] NO status argument — presence only, server preserves status. The
    // heartbeat runs whenever the driver is not offline, which INCLUDES
    // on_job; after an app restart mid-delivery isStreaming() is false (the
    // flag lives in memory), so a status-stamping beat here put busy drivers
    // back in the dispatch pool. Status transitions belong to toggleOnline
    // and advance_order_status, never to a heartbeat. Mig 215 also clamps
    // this server-side.
    pingOnce().catch(() => {
      /* fire-and-forget: a missed beat costs slack, not the shift */
    });
  }, IDLE_HEARTBEAT_MS);
}

export function stopIdleHeartbeat(): void {
  if (!heartbeat) return;
  clearInterval(heartbeat);
  heartbeat = null;
}

/** Test seam: is the heartbeat currently running? */
export function isIdleHeartbeatRunning(): boolean {
  return heartbeat !== null;
}
