import { StyleSheet, Text, View } from 'react-native';
import { colors, font, spacing } from '../theme';
import { useT } from '../i18n';
import { useDirection } from '../lib/direction';

/**
 * App v2 "honest ETA" promise card, shown at the top of checkout.
 *
 * Ported from the design's `.promise` block: a coral-tinted card with a pulsing
 * accent dot, a bold "Promised by {time}" line, and the credit-if-late subline.
 * Pure presentational — takes a formatted `promisedTime` string and renders it;
 * no data fetching, no logic. The pulse dot is static (React Native has no CSS
 * `@keyframes` and cannot animate box-shadow spread) — a solid accent dot reads
 * the same intent without an Animated loop on a screen that already re-renders a
 * lot during checkout.
 */
export function CheckoutPromiseCard({ promisedTime }: { promisedTime: string }) {
  const t = useT();
  const dir = useDirection();
  return (
    <View style={[styles.card, dir.row]}>
      <View style={styles.dot} />
      <View style={{ flex: 1 }}>
        <Text style={[styles.title, dir.text]}>{t('checkout.promiseTitle', { time: promisedTime })}</Text>
        <Text style={[styles.sub, dir.text]}>{t('checkout.promiseSub')}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 13,
    // Design: color-mix(accent 9%, #fff). accentSoft is the app's coral tint.
    backgroundColor: colors.accentSoft,
    borderRadius: 20,
    padding: spacing.lg,
    marginBottom: 12,
  },
  dot: {
    width: 9,
    height: 9,
    borderRadius: 4.5,
    backgroundColor: colors.accent,
    flexShrink: 0,
  },
  title: { fontSize: font.sizes['2xl'], fontWeight: font.weights.extrabold, color: colors.ink },
  sub: { fontSize: font.sizes.md, color: colors.ink2, marginTop: 2 },
});
