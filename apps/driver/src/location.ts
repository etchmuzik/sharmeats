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
  onStreamTerminated,
} from './backgroundLocationTask';
import { getSupabase } from './supabase';
import { deviceLocale } from './deviceLocale';
import {
  DRIVER_LOCALE_STORAGE_KEY,
  trackingNotificationCopy,
} from './i18n';

const DISTANCE_INTERVAL_M = 25; // emit a fix roughly every 25 meters of movement

/**
 * How often an online-but-idle driver re-states "my phone is here and awake".
 *
 * mig 201 made dispatch ignore any driver whose `last_ping_at` is older than
 * `dispatch_max_ping_age_seconds` (300s by default) — correctly, because
 * `drivers.status` survives a force-quit and is intent, not evidence. But the
 * app only pinged on the online/offline toggle, on app-foreground, and from the
 * background location stream, which only runs during an ACTIVE delivery. A
 * driver waiting between jobs with the phone in a pocket therefore aged out of
 * dispatch after five minutes and nothing woke them: the push that would have
 * woken them is exactly the push that stops being sent.
 *
 * 90s sits well inside the 300s window (two consecutive failures are survivable)
 * and comfortably above driver_ping's own 15s server-side throttle (mig 032).
 */
export const IDLE_HEARTBEAT_INTERVAL_MS = 90_000;

/**
 * Outcome of a one-shot position push. Going online has to distinguish these:
 * a driver whose location is unavailable is invisible to dispatch no matter
 * what `drivers.status` says, so we must never show them as receiving offers.
 */
export type PingResult = 'ok' | 'permission_denied' | 'unavailable';

/** The failure half of a PingResult — i.e. "dispatch cannot see this driver". */
export type LocationBlock = Exclude<PingResult, 'ok'>;

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

// The background task can now stop itself (order delivered/cancelled, signed
// out). Mirror that into the foreground view so isStreaming() cannot go on
// claiming a stream that the OS has already torn down.
onStreamTerminated(() => {
  if (!active) return;
  active = null;
  emitHealth('disconnected');
});

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
  // same persisted locale as LanguageProvider instead of using a hook. The
  // device language is the same second choice LanguageProvider makes, so a
  // driver who never touched the toggle still gets an Arabic service
  // notification; English remains the last resort if both are unavailable.
  const storedLocale = await AsyncStorage.getItem(DRIVER_LOCALE_STORAGE_KEY).catch(
    () => null,
  );
  const notification = trackingNotificationCopy(storedLocale ?? deviceLocale());

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

/**
 * One-shot position push (e.g. when going online, to seed current_geo).
 *
 * Never throws — callers treat the RESULT as the signal. Silently swallowing a
 * failure here is what let a driver with denied location permission sit on a
 * screen that said "Online · receiving offers" while being permanently
 * unreachable by dispatch.
 */
export async function pingOnce(status?: 'online' | 'offline' | 'on_job'): Promise<PingResult> {
  let granted: boolean;
  try {
    granted = await requestLocationPermission();
  } catch {
    return 'permission_denied';
  }
  if (!granted) return 'permission_denied';

  let pos: Location.LocationObject;
  try {
    pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
  } catch {
    // Permission is granted but there is no fix: device location services are
    // off, or the GPS has not settled. Dispatch cannot see this driver either.
    return 'unavailable';
  }

  try {
    const { error } = await getSupabase().rpc('driver_ping', {
      p_lng: pos.coords.longitude,
      p_lat: pos.coords.latitude,
      p_status: status ?? '',
    });
    if (error) return 'unavailable';
  } catch {
    return 'unavailable';
  }
  return 'ok';
}

/**
 * Idle heartbeat — the other half of the freshness contract mig 201 introduced.
 *
 * Runs ONLY while the driver is online and has no delivery streaming: the
 * background location task already pings every 25s during a delivery, and a
 * second ping on top of it would just be swallowed by driver_ping's 15s
 * throttle while burning a GPS fix. Deliberately a plain JS timer so this ships
 * over the air; the AppState 'active' ping in home.tsx covers the window where
 * the OS has frozen our timers.
 */
let idleTimer: ReturnType<typeof setInterval> | null = null;

export function startIdleHeartbeat(onResult?: (result: PingResult) => void): void {
  stopIdleHeartbeat();
  idleTimer = setInterval(() => {
    if (isStreaming()) return;
    // Status is deliberately omitted: this heartbeat states WHERE the driver is,
    // never WHAT they are. Re-asserting 'online' here would stamp over an
    // on_job status the server set ([H-DRV3]).
    void pingOnce().then((result) => onResult?.(result));
  }, IDLE_HEARTBEAT_INTERVAL_MS);
}

export function stopIdleHeartbeat(): void {
  if (idleTimer !== null) {
    clearInterval(idleTimer);
    idleTimer = null;
  }
}

export function isIdleHeartbeatRunning(): boolean {
  return idleTimer !== null;
}

export function isStreaming(orderId?: string): boolean {
  if (!active) return false;
  return orderId ? active.orderId === orderId : true;
}
