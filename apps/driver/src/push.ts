/**
 * Expo push notification registration (driver app).
 *
 * The backend half already exists: auto_assign_order() pushes a `new_offer`
 * event to the driver's profile via the expo-push edge function, which looks up
 * tokens in public.push_tokens by user_id. This module is the missing client
 * half — ask permission, fetch the Expo token, store it against the driver's
 * auth user (which equals drivers.profile_id, so the offer push resolves).
 *
 * Notes:
 *  - Remote push only works on a real device with a dev/production build (not
 *    Expo Go or simulators).
 *  - Registration is idempotent; call it after sign-in on every cold start.
 *  - On sign-out call unregisterPush() so the next driver on this device does
 *    not receive the previous account's offers.
 */
import { Platform } from 'react-native';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';
import { getSupabase, isSupabaseConfigured } from './supabase';
import { captureError } from './lib/crash';

let lastToken: string | null = null;

function easProjectId(): string | undefined {
  const fromExtra = (Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined)
    ?.eas?.projectId;
  const fromEas = (Constants as unknown as { easConfig?: { projectId?: string } }).easConfig
    ?.projectId;
  return fromExtra ?? fromEas;
}

/** Foreground presentation: show a banner for a new offer while the app is open. */
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

export async function registerForPush(): Promise<void> {
  if (!isSupabaseConfigured()) return;
  if (Platform.OS === 'web' || !Device.isDevice) return;
  try {
    let { status } = await Notifications.getPermissionsAsync();
    if (status !== 'granted') {
      ({ status } = await Notifications.requestPermissionsAsync());
    }
    if (status !== 'granted') return;

    if (Platform.OS === 'android') {
      // High-importance channel so a new delivery offer surfaces with sound —
      // a driver must not miss an offer (they expire in ~45s).
      await Notifications.setNotificationChannelAsync('offers', {
        name: 'Delivery offers',
        importance: Notifications.AndroidImportance.MAX,
        vibrationPattern: [0, 250, 250, 250],
        sound: 'default',
      });
    }

    const projectId = easProjectId();
    const { data: token } = await Notifications.getExpoPushTokenAsync(
      projectId ? { projectId } : undefined,
    );
    if (!token || token === lastToken) return;

    const sb = getSupabase();
    const {
      data: { user },
    } = await sb.auth.getUser();
    if (!user) return; // not signed in yet; home screen re-runs this after auth
    // The RPC transfers this physical device token away from any prior account.
    // A direct (user_id, token) upsert leaves the same token on both accounts.
    const { error } = await sb.rpc('register_push_token', {
      p_token: token,
      p_platform: Platform.OS as 'ios' | 'android',
    });
    if (error) {
      // Best-effort — never block on push registration — but a failure here
      // means this driver receives NO offers, so it must be visible in Sentry
      // (PGRST202 = register_push_token migration not applied yet).
      captureError(error, { where: 'driver.registerForPush.rpc', code: error.code });
      return;
    }
    lastToken = token;
  } catch {
    // Push is best-effort — never block the app on it.
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
