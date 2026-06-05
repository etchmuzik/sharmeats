import { useCallback } from 'react';
import { useRouter, type Href } from 'expo-router';

/**
 * Safe "go back" for expo-router.
 *
 * `router.back()` dispatches a GO_BACK action that throws
 * "The action 'GO_BACK' was not handled by any navigator" when the current
 * screen is the FIRST entry in its stack — i.e. it was reached via a deep
 * link, a notification, or `router.replace()` (which leave no history to pop).
 *
 * This hook guards the pop with `router.canGoBack()` and, when there is no
 * history, navigates to a sensible parent instead (default: the home tab).
 * Use it everywhere instead of calling `router.back()` directly.
 *
 * @param fallback Where to land when the stack has nothing to pop to.
 *                 Defaults to the home tab.
 *
 * @example
 *   const goBack = useGoBack();                 // falls back to home
 *   const goBack = useGoBack('/(tabs)/profile'); // falls back to profile
 *   <BackButton onPress={goBack} />
 */
export function useGoBack(fallback: Href = '/(tabs)/home') {
  const router = useRouter();
  return useCallback(() => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace(fallback);
    }
  }, [router, fallback]);
}
