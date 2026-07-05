import { useEffect } from 'react';
import { StyleSheet, Text, View, Pressable, AccessibilityInfo } from 'react-native';
import Animated, { useSharedValue, useAnimatedStyle, withTiming, withDelay, withSpring } from 'react-native-reanimated';
import { Mascot } from './Mascot/Mascot';
import { Confetti } from './Confetti';
import { colors, font, radius, spacing, shadow } from '../theme';

export function shouldCelebrate(param: string | string[] | undefined): boolean {
  const v = Array.isArray(param) ? param[0] : param;
  return v === '1';
}

export function OrderCelebration({ visible, etaText, onDone }: {
  visible: boolean; etaText?: string; onDone: () => void;
}) {
  const enter = useSharedValue(0);

  useEffect(() => {
    if (!visible) return;
    AccessibilityInfo.isReduceMotionEnabled().then((reduce) => {
      enter.value = reduce ? 1 : withDelay(80, withSpring(1, { damping: 14 }));
    });
    const timer = setTimeout(onDone, 1600);
    return () => clearTimeout(timer);
  }, [visible, enter, onDone]);

  const cardStyle = useAnimatedStyle(() => ({
    opacity: enter.value,
    transform: [{ translateY: (1 - enter.value) * 40 }, { scale: 0.9 + enter.value * 0.1 }],
  }));

  if (!visible) return null;
  return (
    <Pressable style={styles.scrim} onPress={onDone} accessibilityRole="button" accessibilityLabel="Dismiss">
      <Confetti visible={visible} />
      <Animated.View style={[styles.card, cardStyle]}>
        <View style={styles.glow}>
          <Mascot pose="cheer" size={140} />
        </View>
        <Text style={styles.title}>Order placed! 🎉</Text>
        <Text style={styles.sub}>
          {etaText ? `You'll pay on delivery — arriving ${etaText}` : "You'll pay on delivery — no card needed"}
        </Text>
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  scrim: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(19,19,19,0.55)', alignItems: 'center', justifyContent: 'center', zIndex: 100 },
  card: { alignItems: 'center', backgroundColor: colors.white, borderRadius: radius.xxxl, paddingVertical: spacing.xxxl, paddingHorizontal: spacing.xxl, gap: spacing.sm, ...shadow.card },
  glow: { ...shadow.accentGlow, borderRadius: radius.pill },
  title: { fontSize: font.sizes['7xl'], fontWeight: font.weights.black, color: colors.ink, marginTop: spacing.md },
  sub: { fontSize: font.sizes.xl, color: colors.ink2, textAlign: 'center', maxWidth: 240, lineHeight: 20 },
});
