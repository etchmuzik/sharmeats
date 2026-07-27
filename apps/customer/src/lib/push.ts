/**
 * Expo push notification registration.
 *
 * The backend half already exists: push_tokens table (014) + expo-push edge
 * function fan out order events to whatever tokens are registered. This module
 * is the missing client half — ask permission, fetch the Expo token, hand it
 * to the data layer.
 *
 * Notes:
 *  - Only meaningful in live mode on a real device with a dev/production build
 *    (remote push does not work in Expo Go or simulators).
 *  - Registration is idempotent; we call it after auth on every cold start.
 *  - On sign-out call unregisterPush() so the next user on this device does
 *    not receive the previous account's order updates.
 */
import { useEffect } from 'react';
import { Platform } from 'react-native';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';
import { useRouter } from 'expo-router';
import { db, isBackendLive } from '../data';
import { captureError, track } from './analytics';
import {
  decidePermissionAction,
  permissionAnalytics,
  type PermissionDecision,
  type PermissionState,
  type PrimerContext,
} from './pushPermission';

let lastToken: string | null = null;

function easProjectId(): string | undefined {
  const fromExtra = (Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined)
    ?.eas?.projectId;
  const fromEas = (Constants as unknown as { easConfig?: { projectId?: string } }).easConfig
    ?.projectId;
  return fromExtra ?? fromEas;
}

/** Foreground presentation: show order updates as banners while the app is open. */
export function configureNotificationHandler(): void {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowAlert: true,
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: false,
      shouldSetBadge: false,
    }),
  });
}

/** Read the current OS permission state, or null if it cannot be read. */
async function readPermission(): Promise<PermissionState | null> {
  try {
    const p = await Notifications.getPermissionsAsync();
    return {
      status: p.status as PermissionState['status'],
      ios: (p as { ios?: { status?: number } }).ios ?? null,
      canAskAgain: p.canAskAgain,
    };
  } catch {
    return null;
  }
}

/** What the app should do about push permission right now. */
export async function getPermissionDecision(): Promise<PermissionDecision> {
  return decidePermissionAction(await readPermission(), {
    isDevice: Device.isDevice,
    platform: Platform.OS,
  });
}

/** Android needs an explicit channel or HIGH-importance pushes are silent. */
async function ensureAndroidChannel(): Promise<void> {
  if (Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync('default', {
    name: 'Order updates',
    importance: Notifications.AndroidImportance.HIGH,
    vibrationPattern: [0, 250, 250, 250],
  });
}

/**
 * Obtain and store the Expo token. Assumes permission is already granted —
 * callers decide that via getPermissionDecision().
 */
async function registerToken(): Promise<void> {
  await ensureAndroidChannel();
  const projectId = easProjectId();
  const { data: token } = await Notifications.getExpoPushTokenAsync(
    projectId ? { projectId } : undefined,
  );
  if (!token || token === lastToken) return;
  await db.user.registerPushToken(token, Platform.OS as 'ios' | 'android');
  lastToken = token;
}

/**
 * Startup path: register a token IF permission already exists. NEVER prompts.
 *
 * This used to call requestPermissionsAsync(), so a brand-new customer met the
 * OS dialog before seeing a single restaurant, with nothing explaining what it
 * was for. iOS shows that dialog exactly once, so a reflexive "Don't Allow"
 * was unrecoverable in-app — the easiest possible way to lose the permission
 * permanently.
 *
 * Splitting it also fixes a real bug: someone who denied and later enabled
 * notifications in iOS Settings never got a token, because the only path to
 * registration ran through a request the OS silently refused to show. Now every
 * launch re-checks and registers.
 */
export async function registerForPush(): Promise<void> {
  if (!isBackendLive) return;
  try {
    if ((await getPermissionDecision()) !== 'register') return;
    await registerToken();
  } catch (e) {
    // Push is best-effort — never block app start on it.
    captureError(e, { where: 'registerForPush' });
  }
}

/**
 * Ask the OS, having already shown our own primer.
 *
 * Only call this after the customer has agreed to the primer at a value moment
 * (see PrimerContext). Returns whether permission was granted so the caller can
 * update its UI without re-reading the OS.
 */
export async function requestPushPermission(context: PrimerContext): Promise<boolean> {
  if (!isBackendLive) return false;
  try {
    const decision = await getPermissionDecision();
    if (decision === 'register') {
      await registerToken();
      return true;
    }
    if (decision !== 'may_prompt') return false;

    const { status } = await Notifications.requestPermissionsAsync();
    const granted = status === 'granted';
    // Bounded properties only — never the token (Package 01 §4).
    track('push_permission', permissionAnalytics(context, granted ? 'granted' : 'denied'));
    if (granted) await registerToken();
    return granted;
  } catch (e) {
    captureError(e, { where: 'requestPushPermission' });
    return false;
  }
}

// Map a notification's data payload to an in-app route.
//
// Precedence: an explicit `route` from the sender wins; otherwise fall back to
// the historical orderId-based routing so pushes queued by older senders (and
// every already-delivered notification) still work.
//
// `route` exists because the payload used to carry only orderId, which forced
// senders with no order to smuggle another id into that field — a credit with
// no order sent the USER id, so "credit added to your wallet" opened
// /order/<userId>, a screen that cannot load. Only in-app absolute paths are
// accepted: a push is remote input, and handing an arbitrary string to the
// router would let a malformed payload navigate anywhere.
function routeForNotification(data: Record<string, unknown> | undefined): string | null {
  if (!data) return null;
  const event = typeof data.event === 'string' ? data.event : '';
  const orderId = typeof data.orderId === 'string' ? data.orderId : '';
  const route = typeof data.route === 'string' ? data.route : '';
  if (route.startsWith('/') && !route.startsWith('//')) return route;
  if (event === 'support_reply') return '/support';
  if (event === 'new_message' && orderId) return `/order/${orderId}/chat`;
  if (orderId) return `/order/${orderId}`;
  return null;
}

/**
 * Record a notification open BEFORE navigating (package 01 §4).
 *
 * Order matters: routing can unmount this hook's tree, and on a cold start the
 * push that launched the app is the first thing that happens — track after
 * navigating and the head of the attribution chain is the event most likely to
 * be lost.
 *
 * A notification payload is UNTRUSTED input: it arrives from the network and is
 * not signed. So nothing is forwarded verbatim. `event` is length-capped and
 * character-restricted (an unbounded string becomes an unbounded PostHog
 * property), and the route is reduced to its first path segment — `/order/<id>`
 * becomes `order`, which is what funnel analysis needs and carries no order id.
 * The deny-list in track() is the backstop, not the only defence.
 */
function trackNotificationOpen(data: Record<string, unknown> | undefined, route: string): void {
  const rawEvent = typeof data?.event === 'string' ? data.event : '';
  const event = /^[a-z0-9_]{1,40}$/.test(rawEvent) ? rawEvent : 'unknown';
  const destination = route.split('/').filter(Boolean)[0] ?? 'unknown';
  const campaignId = typeof data?.campaignId === 'string' ? data.campaignId : undefined;
  track('notification_opened', {
    notification_event: event,
    destination,
    ...(campaignId && /^[a-zA-Z0-9-]{1,64}$/.test(campaignId) ? { campaign_id: campaignId } : {}),
  });
}

/**
 * Route notification taps to the right screen — both while the app is running
 * (addNotificationResponseReceivedListener) and on a cold start where the app
 * was launched by tapping a push (getLastNotificationResponseAsync). Mount once
 * from the root layout. Previously order-update pushes carried an orderId that
 * nothing consumed, so a tap just opened the home screen.
 */
export function useNotificationRouting(): void {
  const router = useRouter();
  useEffect(() => {
    let handled = false;
    // Cold start: was the app opened by tapping a notification?
    Notifications.getLastNotificationResponseAsync()
      .then((response) => {
        if (handled || !response) return;
        const data = response.notification.request.content.data as
          | Record<string, unknown>
          | undefined;
        const route = routeForNotification(data);
        if (route) {
          handled = true;
          trackNotificationOpen(data, route);
          router.push(route);
        }
      })
      .catch(() => {});

    // Warm taps while the app is running.
    const sub = Notifications.addNotificationResponseReceivedListener((response) => {
      const data = response.notification.request.content.data as
        | Record<string, unknown>
        | undefined;
      const route = routeForNotification(data);
      if (route) {
        trackNotificationOpen(data, route);
        router.push(route);
      }
    });
    return () => sub.remove();
  }, [router]);
}

/** Best-effort token cleanup on sign-out. */
export async function unregisterPush(): Promise<void> {
  const token = lastToken;
  lastToken = null;
  if (!token || !isBackendLive) return;
  try {
    await db.user.unregisterPushToken(token);
  } catch (e) {
    captureError(e, { where: 'unregisterPush' });
  }
}
