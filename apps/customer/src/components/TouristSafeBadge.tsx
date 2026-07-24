import { Text, View, StyleSheet } from 'react-native';
import { colors, font } from '../theme';

export function TouristSafeBadge() {
  return (
    <View style={styles.b}>
      <Text style={styles.star}>★</Text>
      <Text style={styles.t}>Tourist-safe</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  b: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.seaSoft,
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 6,
    gap: 4,
  },
  star: { color: colors.sea, fontSize: font.sizes.xs, fontWeight: font.weights.bold },
  t: {
    fontSize: font.sizes.xs,
    fontWeight: font.weights.bold,
    color: colors.sea,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
});
