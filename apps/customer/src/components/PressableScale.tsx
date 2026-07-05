import { useEffect, useRef, useState } from 'react';
import { Pressable, PressableProps, AccessibilityInfo } from 'react-native';
import Animated, { useSharedValue, useAnimatedStyle, withSpring } from 'react-native-reanimated';
import { tap, press, selection } from '../haptics';

type HapticKind = 'tap' | 'press' | 'selection' | 'none';

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
  const reduceMotion = useRef(false);
  const [, force] = useState(0);

  useEffect(() => {
    let active = true;
    AccessibilityInfo.isReduceMotionEnabled().then((v) => {
      if (active) { reduceMotion.current = v; force((n) => n + 1); }
    });
    return () => { active = false; };
  }, []);

  const animatedStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  return (
    <AnimatedPressable
      {...rest}
      onPressIn={(e) => {
        const h = resolvePressHaptic(haptic);
        if (h) h();
        if (!reduceMotion.current) scale.value = withSpring(scaleTo, { damping: 15, stiffness: 400 });
        onPressIn?.(e);
      }}
      onPressOut={(e) => {
        if (!reduceMotion.current) scale.value = withSpring(1, { damping: 15, stiffness: 400 });
        onPressOut?.(e);
      }}
      style={[animatedStyle, style as object]}>
      {children}
    </AnimatedPressable>
  );
}
