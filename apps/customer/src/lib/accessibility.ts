/**
 * React Native radios announce their state through `checked`, not `selected`.
 * Keeping that mapping in one place prevents radio controls from silently
 * degrading to an unannounced visual state.
 */
export function radioAccessibilityState(checked: boolean): { checked: boolean } {
  return { checked };
}
