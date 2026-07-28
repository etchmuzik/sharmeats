/**
 * Haptic feedback wrappers.
 *
 * Every call is fire-and-forget and failure-tolerant: haptics are a delight
 * layer, never a correctness one. A device without a Taptic Engine, a user who
 * disabled system haptics, or a permission quirk must never surface an error or
 * block the action that triggered it — so each helper swallows its rejection.
 *
 * Android is intentionally included (unlike iOS-only patterns): drivers in Sharm
 * are predominantly on Android, and expo-haptics maps cleanly onto the Android
 * vibrator. `process.env.EXPO_OS` is used rather than `Platform.OS` per the
 * Expo guidance in this repo.
 */
import * as Haptics from 'expo-haptics';

/** Light tick — routine taps: opening a screen, toggling a filter. */
export function tapLight(): void {
  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
}

/** Medium thud — a committed action: going online, starting a job leg. */
export function tapMedium(): void {
  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
}

/** Heavy thud — high-stakes commitment: accepting a delivery offer. */
export function tapHeavy(): void {
  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy).catch(() => {});
}

/** Success chime — an action completed cleanly (delivery marked complete). */
export function notifySuccess(): void {
  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
}

/** Warning buzz — attention needed, not yet an error (offer about to expire). */
export function notifyWarning(): void {
  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
}

/** Error buzz — an action failed (accept rejected, network down). */
export function notifyError(): void {
  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
}

/**
 * Selection tick. iOS has a dedicated crisp selection generator; Android has no
 * equivalent, so fall back to a light impact rather than emitting nothing.
 */
export function selection(): void {
  if (process.env.EXPO_OS === 'ios') {
    Haptics.selectionAsync().catch(() => {});
    return;
  }
  tapLight();
}
