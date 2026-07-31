/**
 * Expo push notification registration (restaurant app).
 *
 * A new order should BUZZ the kitchen tablet even when the app is backgrounded.
 * The backend pushes an `order_placed_merchant` event to the restaurant's
 * merchant_staff (mig 040); this module registers the tablet's Expo token
 * against the staffer's auth user so that push resolves.
 *
 * Notes:
 *  - Remote push only works on a real device with a dev/production build.
 *  - Registration is idempotent; call it after sign-in on every cold start.
 *  - On sign-out call unregisterPush() so the next staffer on this device does
 *    not receive the previous account's orders.
 */
import { Linking, Platform } from 'react-native';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';
import { getSupabase, isSupabaseConfigured } from './supabase';
import { captureError } from './lib/crash';
import type { PushAlertStatus } from './alerting';

let lastToken: string | null = null;

function easProjectId(): string | undefined {
  const fromExtra = (Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined)
    ?.eas?.projectId;
  const fromEas = (Constants as unknown as { easConfig?: { projectId?: string } }).easConfig
    ?.projectId;
  return fromExtra ?? fromEas;
}

/** Foreground presentation: banner + sound for a new order while the app is open. */
export function configureNotificationHandler(): void {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowAlert: true,
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
  });
}

/**
 * Read the OS notification permission WITHOUT prompting.
 *
 * The home screen re-checks this every time the tablet comes back to the
 * foreground, because the fix for a denied permission happens in Settings, not
 * in this app — and a kitchen that has just turned notifications on must see
 * the warning disappear rather than be told to do it again.
 */
export async function currentPushAlertStatus(): Promise<PushAlertStatus> {
  if (!isSupabaseConfigured()) return 'unsupported';
  if (Platform.OS === 'web' || !Device.isDevice) return 'unsupported';
  try {
    const { status } = await Notifications.getPermissionsAsync();
    return status === 'granted' ? 'granted' : 'denied';
  } catch (e) {
    captureError(e, { where: 'restaurant.currentPushAlertStatus' });
    return 'unknown';
  }
}

/** Open the OS settings page for this app, so a denial can actually be undone. */
export async function openNotificationSettings(): Promise<void> {
  await Linking.openSettings();
}

/**
 * Register this tablet for new-order push, returning where the permission
 * ACTUALLY ended up.
 *
 * The return value is the point: a denied permission used to be a silent early
 * return, so the kiosk showed a queue that promised "a sound alert" while
 * nothing on the device would ever buzz.
 */
export async function registerForPush(): Promise<PushAlertStatus> {
  if (!isSupabaseConfigured()) return 'unsupported';
  if (Platform.OS === 'web' || !Device.isDevice) return 'unsupported';
  try {
    let { status } = await Notifications.getPermissionsAsync();
    if (status !== 'granted') {
      ({ status } = await Notifications.requestPermissionsAsync());
    }
    if (status !== 'granted') return 'denied';

    if (Platform.OS === 'android') {
      // MAX importance + sound so a new order surfaces loudly on the counter tablet.
      await Notifications.setNotificationChannelAsync('orders', {
        name: 'New orders',
        importance: Notifications.AndroidImportance.MAX,
        vibrationPattern: [0, 300, 200, 300],
        sound: 'default',
      });
    }

    const projectId = easProjectId();
    const { data: token } = await Notifications.getExpoPushTokenAsync(
      projectId ? { projectId } : undefined,
    );
    if (!token || token === lastToken) return 'granted';

    const sb = getSupabase();
    const {
      data: { user },
    } = await sb.auth.getUser();
    if (!user) return 'granted'; // not signed in yet; home re-runs this after auth
    // The RPC transfers this physical device token away from any prior account.
    // A direct (user_id, token) upsert leaves the same token on both accounts.
    const { error } = await sb.rpc('register_push_token', {
      p_token: token,
      p_platform: Platform.OS as 'ios' | 'android',
    });
    if (error) {
      // Best-effort — never block on push registration — but a failure here
      // means this kitchen gets NO new-order buzz, so it must be visible in
      // Sentry (PGRST202 = register_push_token migration not applied yet).
      captureError(error, { where: 'restaurant.registerForPush.rpc', code: error.code });
      return 'unknown';
    }
    lastToken = token;
    return 'granted';
  } catch (e) {
    // Push is best-effort — never block the app on it — but the permission is
    // granted and delivery is still broken, which is not something to report as
    // healthy. 'unknown' keeps the banner quiet while Sentry gets the detail.
    captureError(e, { where: 'restaurant.registerForPush' });
    return 'unknown';
  }
}

/** Best-effort token cleanup on sign-out. */
export async function unregisterPush(): Promise<void> {
  const token = lastToken;
  lastToken = null;
  if (!token || !isSupabaseConfigured()) return;
  try {
    await getSupabase().from('push_tokens').delete().eq('token', token);
  } catch {
    // ignore — the registration RPC transfers it on the next authenticated launch
  }
}
