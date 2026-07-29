import { useEffect } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useRouter, type ErrorBoundaryProps } from 'expo-router';
import { captureError } from '../lib/crash';
import { font, radius, spacing } from '../theme';
import { useThemeColors } from '../themeProvider';

/** Route-level recovery instead of losing the kitchen queue to a white screen. */
export function ScreenErrorBoundary({ error, retry }: ErrorBoundaryProps) {
  // Expo-router can mount this ABOVE the layout that provides the theme, in
  // which case the context default (light) applies — the intended degradation.
  const colors = useThemeColors();
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
      }}
    >
      <Text style={{ color: colors.ink, fontSize: font.sizes.xl, fontWeight: '800' }}>
        Something went wrong
      </Text>
      <Text style={{ color: colors.ink2, textAlign: 'center' }}>
        Your order queue is safe. Retry this screen or return home.
      </Text>
      <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm }}>
        <Pressable
          onPress={retry}
          accessibilityRole="button"
          style={{
            backgroundColor: colors.accent,
            borderRadius: radius.lg,
            paddingHorizontal: spacing.xl,
            paddingVertical: spacing.md,
          }}
        >
          <Text style={{ color: colors.onAccent, fontWeight: '700' }}>Retry</Text>
        </Pressable>
        <Pressable
          onPress={() => router.replace('/home')}
          accessibilityRole="button"
          style={{
            borderColor: colors.line,
            borderWidth: 1,
            borderRadius: radius.lg,
            paddingHorizontal: spacing.xl,
            paddingVertical: spacing.md,
          }}
        >
          <Text style={{ color: colors.ink, fontWeight: '700' }}>Home</Text>
        </Pressable>
      </View>
    </View>
  );
}
