import { Text, View, StyleSheet } from 'react-native';
import { colors, radius, font } from '../theme';
import { PressableScale } from './PressableScale';
import { tap } from '../haptics';

type Props = {
  value: number;
  onChange: (next: number) => void;
  min?: number;
  max?: number;
  size?: 'sm' | 'md';
};

export function QuantityStepper({ value, onChange, min = 0, max = 99, size = 'md' }: Props) {
  const sm = size === 'sm';
  // Visuals stay 26-36pt; hitSlop pads each +/- button to a >=44pt effective
  // tap target (HIG minimum). Slops of adjacent controls stay non-overlapping
  // because the value label between them is >=24pt wide.
  const btnWidth = sm ? 26 : 32;
  const btnHeight = sm ? 28 : 36;
  const slopX = Math.ceil((44 - btnWidth) / 2);
  const slopY = Math.ceil((44 - btnHeight) / 2);
  const btnHitSlop = { top: slopY, bottom: slopY, left: slopX, right: slopX };
  return (
    <View
      style={[
        styles.wrap,
        { height: btnHeight, paddingHorizontal: sm ? 2 : 4 },
      ]}>
      <PressableScale
        haptic="none"
        hitSlop={btnHitSlop}
        onPress={() => {
          if (value > min) {
            tap();
            onChange(value - 1);
          }
        }}
        style={[styles.btn, { width: btnWidth }]}>
        <Text style={styles.sym}>−</Text>
      </PressableScale>
      <Text style={[styles.v, { fontSize: sm ? font.sizes.lg : font.sizes['3xl'] }]}>{value}</Text>
      <PressableScale
        haptic="none"
        hitSlop={btnHitSlop}
        onPress={() => {
          if (value < max) {
            tap();
            onChange(value + 1);
          }
        }}
        style={[styles.btn, { width: btnWidth }]}>
        <Text style={styles.sym}>+</Text>
      </PressableScale>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.white,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.line,
  },
  btn: { alignItems: 'center', justifyContent: 'center', height: '100%' },
  sym: { fontSize: 18, color: colors.ink, lineHeight: 20 },
  v: { minWidth: 24, textAlign: 'center', fontWeight: font.weights.bold, color: colors.ink },
});
