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
        notificationTitle: 'Sharm Eats delivery in progress',
        notificationBody: 'Sharing your live location for the active delivery.',
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
