import AsyncStorage from '@react-native-async-storage/async-storage';

const PRESENCE_DISCLOSURE_KEY = '@sharmeats/driver/presence-disclosure-v1';

/** Show the prominent background-location disclosure once, before permission. */
export async function ensurePresenceDisclosure(
  show: () => Promise<boolean>,
): Promise<boolean> {
  if ((await AsyncStorage.getItem(PRESENCE_DISCLOSURE_KEY).catch(() => null)) === 'accepted') {
    return true;
  }
  if (!(await show())) return false;
  await AsyncStorage.setItem(PRESENCE_DISCLOSURE_KEY, 'accepted').catch(() => undefined);
  return true;
}
