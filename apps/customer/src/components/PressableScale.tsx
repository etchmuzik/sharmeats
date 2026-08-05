import { useEffect, useRef, useState } from 'react';
import { Pressable, PressableProps, AccessibilityInfo } from 'react-native';
import Animated, { useSharedValue, useAnimatedStyle, withTiming } from 'react-native-reanimated';
import { tap, press, selection } from '../haptics';

export type HapticKind = 'tap' | 'press' | 'selection' | 'none';

/** A restrained press acknowledgement, not a bouncy decorative animation. */
export const PRESS_FEEDBACK_DURATION_MS = 90;
export const DEFAULT_REDUCE_MOTION = true;

export function shouldAnimatePressFeedback(reduceMotion: boolean): boolean {
  return !reduceMotion;
}

/**
 * Keeps press feedback aligned with a setting change while the app is open.
 * The initial query can resolve after an event, so it must not overwrite a
 * newer accessibility preference.
 */
export function subscribeToReduceMotion(onChange: (isEnabled: boolean) => void): () => void {
  let active = true;
  let receivedLiveValue = false;
  const handleChange = (isEnabled: boolean) => {
    if (!active) return;
    receivedLiveValue = true;
    onChange(isEnabled);
  };

  void AccessibilityInfo.isReduceMotionEnabled()
    .then((isEnabled) => {
      if (active && !receivedLiveValue) onChange(isEnabled);
    })
    .catch(() => {
      if (active && !receivedLiveValue) onChange(DEFAULT_REDUCE_MOTION);
    });

  const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', handleChange);
  return () => {
    active = false;
    subscription.remove();
  };
}

export function resolvePressHaptic(kind: HapticKind): (() => void) | null {
  switch (kind) {
    case 'none': return null;
    case 'tap': return tap;
    case 'press': return press;
    case 'selection': return selection;
  }
}

export interface PressableScaleProps extends PressableProps {
  scaleTo?: number;
  haptic?: HapticKind;
  children: React.ReactNode;
}

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

export function PressableScale({
  scaleTo = 0.96, haptic = 'tap', children, onPressIn, onPressOut, style, ...rest
}: PressableScaleProps) {
  const scale = useSharedValue(1);
  const reduceMotion = useRef(DEFAULT_REDUCE_MOTION);
  const [, force] = useState(0);

  useEffect(() => {
    return subscribeToReduceMotion((isEnabled) => {
      reduceMotion.current = isEnabled;
      force((n) => n + 1);
    });
  }, []);

  const animatedStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  return (
    <AnimatedPressable
      {...rest}
      onPressIn={(e) => {
        const h = resolvePressHaptic(haptic);
        if (h) h();
        if (shouldAnimatePressFeedback(reduceMotion.current)) {
          scale.value = withTiming(scaleTo, { duration: PRESS_FEEDBACK_DURATION_MS });
        }
        onPressIn?.(e);
      }}
      onPressOut={(e) => {
        if (shouldAnimatePressFeedback(reduceMotion.current)) {
          scale.value = withTiming(1, { duration: PRESS_FEEDBACK_DURATION_MS });
        }
        onPressOut?.(e);
      }}
      style={[animatedStyle, style as object]}>
      {children}
    </AnimatedPressable>
  );
}
