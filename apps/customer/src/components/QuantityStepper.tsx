import { Text, View, StyleSheet } from 'react-native';
import { colors, radius, font } from '../theme';
import { PressableScale } from './PressableScale';

type Props = {
  value: number;
  onChange: (next: number) => void;
  min?: number;
  max?: number;
  size?: 'sm' | 'md';
};

export function QuantityStepper({ value, onChange, min = 0, max = 99, size = 'md' }: Props) {
  const sm = size === 'sm';
  return (
    <View
      style={[
        styles.wrap,
        { height: sm ? 28 : 36, paddingHorizontal: sm ? 2 : 4 },
      ]}>
      <PressableScale
        haptic="tap"
        onPress={() => {
          if (value > min) {
            onChange(value - 1);
          }
        }}
        style={[styles.btn, { width: sm ? 26 : 32 }]}>
        <Text style={styles.sym}>−</Text>
      </PressableScale>
      <Text style={[styles.v, { fontSize: sm ? font.sizes.lg : font.sizes['3xl'] }]}>{value}</Text>
      <PressableScale
        haptic="tap"
        onPress={() => {
          if (value < max) {
            onChange(value + 1);
          }
        }}
        style={[styles.btn, { width: sm ? 26 : 32 }]}>
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
