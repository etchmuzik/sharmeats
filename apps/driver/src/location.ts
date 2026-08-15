/**
 * Driver location and presence.
 *
 * Active deliveries use a high-frequency OS location task and publish both a
 * private Realtime dot and an authoritative driver_ping. Online drivers between
 * jobs use the same OS task at low frequency, so a suspended JavaScript timer
 * cannot silently age them out of the dispatch pool.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Location from 'expo-location';
import {
  ACTIVE_ORDER_STORAGE_KEY,
  DRIVER_LOCATION_TASK,
  DRIVER_ONLINE_STORAGE_KEY,
} from './backgroundLocationTask';
import {
  DRIVER_LOCALE_STORAGE_KEY,
  presenceNotificationCopy,
  trackingNotificationCopy,
} from './i18n';
import { getSupabase } from './supabase';

const ACTIVE_DISTANCE_INTERVAL_M = 25;
const IDLE_HEARTBEAT_MS = 120_000;

interface ActiveStream {
  orderId: string;
  connected: boolean;
}

let active: ActiveStream | null = null;
let heartbeat: ReturnType<typeof setInterval> | null = null;
let presenceStart: Promise<void> | null = null;

/** Connection-health states the caller can surface. */
export type StreamHealth = 'connected' | 'reconnecting' | 'disconnected';
let healthListener: ((health: StreamHealth) => void) | null = null;

export function onStreamHealth(cb: ((health: StreamHealth) => void) | null): void {
  healthListener = cb;
}

function emitHealth(health: StreamHealth): void {
  if (active) active.connected = health === 'connected';
  healthListener?.(health);
}

export async function requestLocationPermission(): Promise<boolean> {
  const { status } = await Location.requestForegroundPermissionsAsync();
  return status === 'granted';
}

async function requireBackgroundLocation(): Promise<void> {
  if (!(await requestLocationPermission())) {
    throw new Error('Location permission denied');
  }
  const background = await Location.requestBackgroundPermissionsAsync();
  if (background.status !== 'granted') {
    throw new Error(
      'Background location is required while online. Allow location all the time in Settings.',
    );
  }
}

async function taskStarted(): Promise<boolean> {
  return Location.hasStartedLocationUpdatesAsync(DRIVER_LOCATION_TASK).catch(() => false);
}

async function stopLocationTask(): Promise<void> {
  if (await taskStarted()) {
    await Location.stopLocationUpdatesAsync(DRIVER_LOCATION_TASK);
  }
}

async function notificationCopy(mode: 'delivery' | 'presence') {
  const storedLocale = await AsyncStorage.getItem(DRIVER_LOCALE_STORAGE_KEY).catch(
    () => null,
  );
  return mode === 'delivery'
    ? trackingNotificationCopy(storedLocale)
    : presenceNotificationCopy(storedLocale);
}

async function startLocationTask(mode: 'delivery' | 'presence'): Promise<void> {
  const notification = await notificationCopy(mode);
  const delivery = mode === 'delivery';
  await Location.startLocationUpdatesAsync(DRIVER_LOCATION_TASK, {
    accuracy: delivery ? Location.Accuracy.Balanced : Location.Accuracy.Low,
    // A stationary driver still needs a fix. `0` plus deferred batching lets
    // iOS keep the task alive without depending on movement; Android also uses
    // the explicit time interval below.
    distanceInterval: delivery ? ACTIVE_DISTANCE_INTERVAL_M : 0,
    timeInterval: delivery ? 5_000 : IDLE_HEARTBEAT_MS,
    deferredUpdatesDistance: delivery ? ACTIVE_DISTANCE_INTERVAL_M : 0,
    deferredUpdatesInterval: delivery ? 5_000 : IDLE_HEARTBEAT_MS,
    activityType: delivery
      ? Location.ActivityType.AutomotiveNavigation
      : Location.ActivityType.OtherNavigation,
    pausesUpdatesAutomatically: false,
    showsBackgroundLocationIndicator: true,
    foregroundService: {
      notificationTitle: notification.title,
      notificationBody: notification.body,
      notificationColor: '#0E7C91',
      killServiceOnDestroy: false,
    },
  });
}

async function ensureIdleLocationTask(): Promise<void> {
  if (await AsyncStorage.getItem(ACTIVE_ORDER_STORAGE_KEY)) return;
  if (await taskStarted()) return;
  await requireBackgroundLocation();
  await startLocationTask('presence');
}

/** Start high-frequency, background-capable tracking for an active order. */
export async function startStreaming(orderId: string): Promise<void> {
  const normalizedOrderId = orderId.trim();
  if (!normalizedOrderId) throw new Error('Order id is required for live tracking');
  if (active?.orderId === normalizedOrderId && (await taskStarted())) return;

  // Do not tear down working idle presence until permission is confirmed.
  await requireBackgroundLocation();
  await stopLocationTask();
  await AsyncStorage.setItem(ACTIVE_ORDER_STORAGE_KEY, normalizedOrderId);
  try {
    await startLocationTask('delivery');
  } catch (error) {
    await AsyncStorage.removeItem(ACTIVE_ORDER_STORAGE_KEY);
    // Preserve availability if switching task modes failed.
    if ((await AsyncStorage.getItem(DRIVER_ONLINE_STORAGE_KEY)) === '1') {
      await ensureIdleLocationTask().catch(() => undefined);
    }
    throw error;
  }

  active = { orderId: normalizedOrderId, connected: true };
  emitHealth('connected');
  await pingOnce();
}

/** Stop delivery streaming and return to idle presence if the driver is online. */
export async function stopStreaming(): Promise<void> {
  await stopLocationTask();
  await AsyncStorage.removeItem(ACTIVE_ORDER_STORAGE_KEY);
  active = null;
  emitHealth('disconnected');

  if ((await AsyncStorage.getItem(DRIVER_ONLINE_STORAGE_KEY)) === '1') {
    // Completing an order must not be reported as failed just because the
    // lower-frequency task could not restart; the foreground timer still has
    // retry slack and the next home load will retry the OS task.
    await ensureIdleLocationTask().catch(() => undefined);
  }
}

/** One-shot authoritative position update. */
export async function pingOnce(status?: 'online' | 'offline' | 'on_job'): Promise<void> {
  if (!(await requestLocationPermission())) return;
  const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
  try {
    await getSupabase().rpc('driver_ping', {
      p_lng: pos.coords.longitude,
      p_lat: pos.coords.latitude,
      p_status: status ?? '',
    });
  } catch {
    // The next foreground or OS-backed beat retries within the freshness slack.
  }
}

export function isStreaming(orderId?: string): boolean {
  if (!active) return false;
  return orderId ? active.orderId === orderId : true;
}

/**
 * Keep a foreground beat for immediacy and an OS task for suspended/background
 * execution. The persisted marker is also read by the headless task.
 */
async function startIdlePresence(): Promise<void> {
  if (!heartbeat) {
    heartbeat = setInterval(() => {
      if (isStreaming()) return;
      void pingOnce();
    }, IDLE_HEARTBEAT_MS);
  }

  await AsyncStorage.setItem(DRIVER_ONLINE_STORAGE_KEY, '1');
  try {
    await ensureIdleLocationTask();
    if (!isStreaming()) await pingOnce();
  } catch (error) {
    if (heartbeat) clearInterval(heartbeat);
    heartbeat = null;
    await AsyncStorage.removeItem(DRIVER_ONLINE_STORAGE_KEY);
    throw error;
  }
}

export async function startIdleHeartbeat(): Promise<void> {
  if (presenceStart) return presenceStart;
  presenceStart = startIdlePresence();
  try {
    await presenceStart;
  } finally {
    presenceStart = null;
  }
}

/** Clear online intent and stop idle tracking. Active delivery cleanup is separate. */
export async function stopIdleHeartbeat(): Promise<void> {
  if (presenceStart) await presenceStart.catch(() => undefined);
  if (heartbeat) clearInterval(heartbeat);
  heartbeat = null;
  await AsyncStorage.removeItem(DRIVER_ONLINE_STORAGE_KEY);
  if (!(await AsyncStorage.getItem(ACTIVE_ORDER_STORAGE_KEY))) {
    await stopLocationTask();
  }
}

/** Test/diagnostic seam. */
export function isIdleHeartbeatRunning(): boolean {
  return heartbeat !== null;
}
