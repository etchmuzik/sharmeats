import { useEffect } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useRouter, type ErrorBoundaryProps } from 'expo-router';
import { captureError } from '../lib/crash';
import { font, radius, spacing } from '../theme';
import { useThemeColors } from '../themeProvider';
import { useSafeLocale } from '../locale';

/** Route-level recovery instead of losing the kitchen queue to a white screen. */
export function ScreenErrorBoundary({ error, retry }: ErrorBoundaryProps) {
  // Expo-router can mount this ABOVE the layout that provides the theme, in
  // which case the context default (light) applies — the intended degradation.
  const colors = useThemeColors();
  // Same reasoning for language, hence useSafeLocale rather than useLocale: a
  // hook that THROWS when its provider is the thing that failed would turn the
  // recovery screen into a second crash.
  const { direction, t } = useSafeLocale();
  const router = useRouter();
  useEffect(() => {
    captureError(error, { where: 'restaurant.ScreenErrorBoundary' });
  }, [error]);

  return (
    <View
      style={{
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: colors.bg,
        padding: spacing.xxl,
        gap: spacing.md,
        direction,
      }}
    >
      <Text style={{ color: colors.ink, fontSize: font.sizes.xl, fontWeight: '800' }}>
        {t('error.title')}
      </Text>
      <Text style={{ color: colors.ink2, textAlign: 'center' }}>{t('error.body')}</Text>
      <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm }}>
        <Pressable
          onPress={retry}
          accessibilityRole="button"
          accessibilityLabel={t('error.retry')}
          style={{
            backgroundColor: colors.accent,
            borderRadius: radius.lg,
            paddingHorizontal: spacing.xl,
            paddingVertical: spacing.md,
          }}
        >
          <Text style={{ color: colors.onAccent, fontWeight: '700' }}>{t('error.retry')}</Text>
        </Pressable>
        <Pressable
          onPress={() => router.replace('/home')}
          accessibilityRole="button"
          accessibilityLabel={t('error.home')}
          style={{
            borderColor: colors.line,
            borderWidth: 1,
            borderRadius: radius.lg,
            paddingHorizontal: spacing.xl,
            paddingVertical: spacing.md,
          }}
        >
          <Text style={{ color: colors.ink, fontWeight: '700' }}>{t('error.home')}</Text>
        </Pressable>
      </View>
    </View>
  );
}
