import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import type { ErrorBoundaryProps } from 'expo-router';
import { colors, font, radius } from '../theme';
import { useT } from '../i18n';
import { captureError } from '../lib/analytics';

/**
 * Per-route error fallback for Expo Router. Export it as `ErrorBoundary` from a
 * route file and any error thrown while that screen renders is caught here —
 * the user sees a friendly retry screen and the error is reported, instead of
 * the whole app white-screening/crashing.
 *
 * Expo Router calls this with { error, retry }. We also report to Sentry via
 * captureError so a real on-device crash becomes a visible, diagnosable event.
 */
export function ScreenErrorBoundary({ error, retry }: ErrorBoundaryProps) {
  const t = useT();
  const router = useRouter();
  captureError(error, { where: 'ScreenErrorBoundary' });

  return (
    <View style={styles.wrap}>
      <Text style={styles.emoji}>😕</Text>
      <Text style={styles.msg}>{t('common.error')}</Text>
      <View style={styles.row}>
        <Pressable
          onPress={retry}
          accessibilityRole="button"
          accessibilityLabel={t('common.retry')}
          style={styles.primary}>
          <Text style={styles.primaryText}>{t('common.retry')}</Text>
        </Pressable>
        <Pressable
          onPress={() => (router.canGoBack() ? router.back() : router.replace('/(tabs)/home'))}
          accessibilityRole="button"
          accessibilityLabel={t('common.back')}
          style={styles.secondary}>
          <Text style={styles.secondaryText}>{t('common.back')}</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg, padding: 32, gap: 16 },
  emoji: { fontSize: 40 },
  msg: { fontSize: font.sizes.lg, color: colors.ink2, textAlign: 'center', lineHeight: 24 },
  row: { flexDirection: 'row', gap: 12, marginTop: 8 },
  primary: { paddingHorizontal: 22, paddingVertical: 12, borderRadius: radius.pill, backgroundColor: colors.ink },
  primaryText: { color: colors.white, fontSize: font.sizes.lg, fontWeight: font.weights.bold },
  secondary: { paddingHorizontal: 22, paddingVertical: 12, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.line },
  secondaryText: { color: colors.ink, fontSize: font.sizes.lg, fontWeight: font.weights.bold },
});
