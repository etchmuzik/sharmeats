import { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';
import { colors, radius, shadow } from '../theme';

/**
 * Pulsing placeholder shown while the restaurant list loads. Mirrors
 * RestaurantCard's layout (96px cover + text lines) so the list doesn't
 * jump when real cards arrive. Pure presentation: no data, no navigation.
 */
export function SkeletonRestaurantCard() {
  const opacity = useRef(new Animated.Value(0.55)).current;

  useEffect(() => {
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
  }, [opacity]);

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

const styles = StyleSheet.create({
  // Match RestaurantCard's card + cover dimensions exactly.
  card: {
    backgroundColor: colors.white,
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
});
