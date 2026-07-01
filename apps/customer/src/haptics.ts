import * as Haptics from 'expo-haptics';
import { Platform } from 'react-native';

const enabled = Platform.OS !== 'web';

// Haptics are non-essential tactile feedback. They must NEVER be able to crash
// the app. Under the React Native New Architecture, a native exception thrown
// inside expo-haptics' void TurboModule methods propagates synchronously off the
// turbomodule queue with no @try/@catch around it → std::terminate → SIGABRT.
// A `.catch()` on the returned Promise does NOT help: the throw can happen at the
// synchronous invocation, before/instead of a Promise rejection (the process dies,
// the Promise never rejects). So we wrap EVERY call in a synchronous try/catch AND
// keep the async .catch() — belt and suspenders — so haptics degrade to a no-op
// instead of aborting. (We also ship with newArchEnabled=false so the old bridge
// swallows such native throws, but this guard stands on its own.)
const safeHaptic = (run: () => Promise<void>) => {
  if (!enabled) return;
  try {
    run().catch(() => {});
  } catch {
    // Native invocation threw synchronously — swallow; haptics are best-effort.
  }
};

export const tap = () => {
  safeHaptic(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light));
};

export const press = () => {
  safeHaptic(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium));
};

export const success = () => {
  safeHaptic(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success));
};

export const warn = () => {
  safeHaptic(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning));
};

export const selection = () => {
  safeHaptic(() => Haptics.selectionAsync());
};
