import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Easing, View } from 'react-native';
import { radius, shadow } from '../theme';
import { makeStyles } from '../themeProvider';

/**
 * Pulsing placeholder shown while the restaurant list loads. Mirrors
 * RestaurantCard's layout (96px cover + text lines) so the list doesn't
 * jump when real cards arrive. Pure presentation: no data, no navigation.
 */
export function shouldAnimateSkeleton(reduceMotion: boolean | null): boolean {
  return reduceMotion === false;
}

export function SkeletonRestaurantCard() {
  const styles = useStyles();
  const opacity = useRef(new Animated.Value(0.55)).current;
  // Start still until the system setting has resolved. This avoids a brief
  // shimmer flash for people who have explicitly asked for reduced motion.
  const [reduceMotion, setReduceMotion] = useState<boolean | null>(null);

  useEffect(() => {
    let mounted = true;
    void AccessibilityInfo.isReduceMotionEnabled()
      .then((enabled) => {
        if (mounted) setReduceMotion(enabled);
      })
      // If the accessibility service is unavailable, retain the ordinary
      // loading affordance rather than leaving a permanent static skeleton.
      .catch(() => {
        if (mounted) setReduceMotion(false);
      });
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);

    return () => {
      mounted = false;
      subscription.remove();
    };
  }, []);

  useEffect(() => {
    if (!shouldAnimateSkeleton(reduceMotion)) {
      opacity.setValue(0.72);
      return;
    }

    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, {
          toValue: 1,
          duration: 700,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(opacity, {
          toValue: 0.55,
          duration: 700,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [opacity, reduceMotion]);

  return (
    <View
      style={styles.card}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants">
      <Animated.View style={[styles.row, { opacity }]}>
        <View style={styles.ph} />
        <View style={styles.body}>
          <View style={[styles.bar, styles.barName]} />
          <View style={[styles.bar, styles.barCuisine]} />
          <View style={[styles.bar, styles.barMetrics]} />
        </View>
      </Animated.View>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  // Match RestaurantCard's card + cover dimensions exactly.
  card: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.xl,
    padding: 10,
    ...shadow.soft,
  },
  row: { flexDirection: 'row', gap: 12 },
  ph: { width: 96, height: 96, borderRadius: radius.md, backgroundColor: colors.bgSoft },
  body: { flex: 1, gap: 10, paddingTop: 4 },
  bar: { height: 12, borderRadius: radius.sm, backgroundColor: colors.bgSoft },
  barName: { width: '65%', height: 16 },
  barCuisine: { width: '40%' },
  barMetrics: { width: '85%', marginTop: 'auto', marginBottom: 4 },
}));
