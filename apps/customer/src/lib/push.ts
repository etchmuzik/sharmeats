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
import { Platform } from 'react-native';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';
import { db, isBackendLive } from '../data';
import { captureError, track } from './analytics';

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
      shouldPlaySound: false,
      shouldSetBadge: false,
    }),
  });
}

export async function registerForPush(): Promise<void> {
  if (!isBackendLive) return;
  if (Platform.OS === 'web' || !Device.isDevice) return;
  try {
    let { status } = await Notifications.getPermissionsAsync();
    if (status !== 'granted') {
      ({ status } = await Notifications.requestPermissionsAsync());
      track('push_permission', { status });
    }
    if (status !== 'granted') return;

    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('default', {
        name: 'Order updates',
        importance: Notifications.AndroidImportance.HIGH,
        vibrationPattern: [0, 250, 250, 250],
      });
    }

    const projectId = easProjectId();
    const { data: token } = await Notifications.getExpoPushTokenAsync(
      projectId ? { projectId } : undefined,
    );
    if (!token || token === lastToken) return;
    await db.user.registerPushToken(token, Platform.OS as 'ios' | 'android');
    lastToken = token;
  } catch (e) {
    // Push is best-effort — never block app start on it.
    captureError(e, { where: 'registerForPush' });
  }
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
