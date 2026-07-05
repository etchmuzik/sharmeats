import { Text, View, StyleSheet } from 'react-native';
import { colors, font, shadow } from '../theme';
import { PressableScale } from './PressableScale';

/**
 * App v2 circular category chip — a lighter interpretation of the design's arc
 * category picker. The design's arc structurally caps at ~5 items (hardcoded
 * -46°…46° rotations); the app has 13 cuisines, so a faithful arc would either
 * hide categories or break. This keeps the design's DNA — a large circular
 * icon over a label, coral-on-active — while staying a horizontally scrollable
 * row that holds all 13. Pure presentational; selection semantics are the
 * caller's (same onPress → setCuisine as the old pill).
 */
type Props = { label: string; emoji?: string; active?: boolean; onPress: () => void };

const SIZE = 56;

export function CuisineChip({ label, emoji, active, onPress }: Props) {
  return (
    <PressableScale
      haptic="selection"
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: !!active }}
      accessibilityLabel={label}
      style={styles.wrap}>
      <View style={[styles.circle, active && styles.circleActive]}>
        <Text style={styles.emoji}>{emoji || '🍽️'}</Text>
      </View>
      <Text numberOfLines={1} style={[styles.label, active && styles.labelActive]}>
        {label}
      </Text>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', width: 68, gap: 6 },
  circle: {
    width: SIZE,
    height: SIZE,
    borderRadius: SIZE / 2,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.line,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadow.soft,
  },
  circleActive: { backgroundColor: colors.accentSoft, borderColor: colors.accent },
  emoji: { fontSize: 24 },
  label: { fontSize: font.sizes.sm, fontWeight: font.weights.bold, color: colors.ink2, textAlign: 'center' },
  labelActive: { color: colors.accent },
});
