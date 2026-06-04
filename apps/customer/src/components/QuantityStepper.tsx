import { Pressable, Text, View, StyleSheet } from 'react-native';
import { colors, radius, font } from '../theme';
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
  return (
    <View
      style={[
        styles.wrap,
        { height: sm ? 28 : 36, paddingHorizontal: sm ? 2 : 4 },
      ]}>
      <Pressable
        onPress={() => {
          if (value > min) {
            tap();
            onChange(value - 1);
          }
        }}
        style={[styles.btn, { width: sm ? 26 : 32 }]}>
        <Text style={styles.sym}>−</Text>
      </Pressable>
      <Text style={[styles.v, { fontSize: sm ? font.sizes.lg : font.sizes['3xl'] }]}>{value}</Text>
      <Pressable
        onPress={() => {
          if (value < max) {
            tap();
            onChange(value + 1);
          }
        }}
        style={[styles.btn, { width: sm ? 26 : 32 }]}>
        <Text style={styles.sym}>+</Text>
      </Pressable>
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
