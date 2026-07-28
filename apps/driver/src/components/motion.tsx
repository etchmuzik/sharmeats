/**
 * Shared motion presets.
 *
 * Screens reference motion by INTENT (`cardEnter`, `urgentPulse`), not by raw
 * Reanimated config, so timing can be retuned in one place — the same pattern
 * `Icon.tsx` applies to glyphs.
 *
 * Durations are deliberately short (160–260ms). This is a working tool used
 * one-handed, often mid-ride: motion here exists to explain *what changed*
 * (a card arrived, a card left), never to decorate. Anything slower than ~260ms
 * starts to feel like latency rather than feedback.
 */
import { useEffect } from 'react';
import Animated, {
  Easing,
  FadeIn,
  FadeOut,
  LinearTransition,
  SlideInDown,
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

/** A new card arriving in a list — slides up as it fades in. */
export const cardEnter = SlideInDown.duration(240).easing(Easing.out(Easing.cubic));

/** A card leaving (accepted, declined, expired) — fades out fast. */
export const cardExit = FadeOut.duration(160);

/** Neighbours reflowing after an item is added or removed. */
export const listReflow = LinearTransition.duration(220).easing(Easing.inOut(Easing.quad));

/** Generic content fade for section swaps and state changes. */
export const contentEnter = FadeIn.duration(200);

/**
 * Pulses a value between 1 and `peak` while `active` is true, returning a style
 * to spread onto an Animated.View. Used to escalate urgency on an expiring
 * offer without a distracting continuous loop.
 *
 * The animation is cancelled on deactivation and on unmount so the worklet does
 * not keep running behind a dismissed card.
 */
export function usePulse(active: boolean, peak = 1.04) {
  const scale = useSharedValue(1);

  useEffect(() => {
    if (!active) {
      cancelAnimation(scale);
      scale.value = withTiming(1, { duration: 160 });
      return;
    }
    scale.value = withRepeat(
      withSequence(
        withTiming(peak, { duration: 380, easing: Easing.inOut(Easing.quad) }),
        withTiming(1, { duration: 380, easing: Easing.inOut(Easing.quad) }),
      ),
      -1,
      false,
    );
    return () => cancelAnimation(scale);
  }, [active, peak, scale]);

  return useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
}

/**
 * Drives a 1→0 progress bar for a countdown. `fraction` is the caller's
 * remaining ratio (1 = full time left, 0 = expired); the width eases toward it
 * each tick so the bar glides instead of stepping once per second.
 */
export function useCountdownBar(fraction: number) {
  const width = useSharedValue(fraction);

  useEffect(() => {
    width.value = withTiming(Math.max(0, Math.min(1, fraction)), {
      duration: 1000,
      easing: Easing.linear,
    });
  }, [fraction, width]);

  return useAnimatedStyle(() => ({ width: `${width.value * 100}%` }));
}

export { Animated };
