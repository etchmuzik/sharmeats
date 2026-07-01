import { StyleSheet, Text, View } from 'react-native';
import { colors, font } from '../theme';
import { useT } from '../i18n';

/**
 * Static progress indicator. Checkout IS the "Details" step — Cart and
 * Payment are the prior/next screens in the existing flow. Purely visual;
 * carries no navigation or state of its own.
 */
export function CheckoutStepper() {
  const t = useT();
  return (
    <View style={styles.row}>
      <Step label={t('checkout.stepperCart')} state="done" />
      <View style={styles.line} />
      <Step label={t('checkout.stepperDetails')} state="active" />
      <View style={styles.line} />
      <Step label={t('checkout.stepperPayment')} state="pending" />
    </View>
  );
}

function Step({ label, state }: { label: string; state: 'done' | 'active' | 'pending' }) {
  const filled = state !== 'pending';
  return (
    <View style={styles.step}>
      <View style={[styles.dot, filled ? styles.dotFilled : styles.dotEmpty]} />
      <Text style={[styles.label, filled ? styles.labelFilled : styles.labelEmpty]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    paddingHorizontal: 16,
    backgroundColor: colors.bgSoft,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  step: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  dotFilled: { backgroundColor: colors.accent ?? colors.ink },
  dotEmpty: { backgroundColor: colors.line },
  label: { fontSize: font.sizes.xs, marginLeft: 2 },
  labelFilled: { color: colors.ink2, fontWeight: font.weights.bold },
  labelEmpty: { color: colors.ink3 },
  line: { width: 16, height: 1, backgroundColor: colors.line, marginHorizontal: 6 },
});
