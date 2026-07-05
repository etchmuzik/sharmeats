import { AccessibilityInfo, StyleSheet, View } from 'react-native';
import Animated, { useSharedValue, useAnimatedStyle, withTiming, withDelay } from 'react-native-reanimated';
import { useEffect, useState } from 'react';
import { colors } from '../theme';

const DEFAULT_PALETTE = [colors.accent, colors.sea, colors.star];

export interface Particle {
  id: number; x: number; angle: number; distance: number; color: string; delay: number;
}

export function buildParticles(count: number, palette: string[]): Particle[] {
  return Array.from({ length: count }, (_, i) => ({
    id: i,
    x: 0,
    angle: (i * 360) / count,
    distance: 90 + (i % 3) * 30,
    color: palette[i % palette.length],
    delay: (i % 5) * 40,
  }));
}

function Dot({ p, progress }: { p: Particle; progress: { value: number } }) {
  const style = useAnimatedStyle(() => {
    const rad = (p.angle * Math.PI) / 180;
    const t = progress.value;
    return {
      opacity: 1 - t,
      transform: [
        { translateX: Math.cos(rad) * p.distance * t },
        { translateY: Math.sin(rad) * p.distance * t },
        { scale: 1 - t * 0.4 },
      ],
    };
  });
  return <Animated.View style={[styles.dot, { backgroundColor: p.color }, style]} />;
}

export function Confetti({ visible, count = 14, palette = DEFAULT_PALETTE }: {
  visible: boolean; count?: number; palette?: string[];
}) {
  const progress = useSharedValue(0);
  // Fail closed for a11y: stay hidden until the OS reduce-motion setting is known to be off.
  const [reduceMotion, setReduceMotion] = useState(true);
  const particles = buildParticles(count, palette);

  useEffect(() => {
    let cancelled = false;
    AccessibilityInfo.isReduceMotionEnabled().then((reduce) => {
      if (!cancelled) setReduceMotion(reduce);
    });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (visible && !reduceMotion) { progress.value = 0; progress.value = withDelay(60, withTiming(1, { duration: 900 })); }
  }, [visible, reduceMotion, progress]);

  // Per the delight-pass spec, the celebration collapses to static under reduced motion — no confetti at all.
  if (!visible || reduceMotion) return null;
  return (
    <View pointerEvents="none" style={styles.wrap}>
      {particles.map((p) => <Dot key={p.id} p={p} progress={progress} />)}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' },
  dot: { position: 'absolute', width: 10, height: 10, borderRadius: 3 },
});
