import { useEffect } from 'react';
import { AppState } from 'react-native';
import { Stack } from 'expo-router';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AuthProvider } from '../src/auth';
import { ToastProvider } from '../src/components/Toast';
import { ThemeProvider, ThemedStatusBar, useThemeColors } from '../src/themeProvider';
import { initCrashReporting } from '../src/lib/crash';
import { getSupabase, isSupabaseConfigured } from '../src/supabase';
import { ScreenErrorBoundary } from '../src/components/ScreenErrorBoundary';
import { LanguageProvider, useI18n } from '../src/i18n-context';
import '../src/backgroundLocationTask';

export { ScreenErrorBoundary as ErrorBoundary };

// Boot crash reporting before the tree renders (no-op unless EXPO_PUBLIC_SENTRY_DSN
// is set). The driver app runs unattended mid-delivery — a silent crash is the
// worst blind spot, so this runs first.
initCrashReporting();

export default function RootLayout() {
  useEffect(() => {
    if (!isSupabaseConfigured()) return;
    const sb = getSupabase();
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') sb.auth.startAutoRefresh();
      else sb.auth.stopAutoRefresh();
    });
    if (AppState.currentState === 'active') sb.auth.startAutoRefresh();
    return () => {
      sub.remove();
      sb.auth.stopAutoRefresh();
    };
  }, []);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <ThemeProvider>
          <LanguageProvider>
            <AuthProvider>
              <ToastProvider>
                <ThemedStatusBar />
                <DriverStack />
              </ToastProvider>
            </AuthProvider>
          </LanguageProvider>
        </ThemeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

/**
 * The navigator, split out so it can read the active palette and locale — the
 * native header is chrome the OS draws for us, so its colors and titles have to
 * be passed in rather than styled by a child. Left in light, it would sit as a
 * bright slab above every dark screen.
 *
 * Native headers (large titles + native back) rather than hand-rolled ones:
 * they give correct safe-area handling for free via
 * `contentInsetAdjustmentBehavior="automatic"` on each screen's scroller, and a
 * back gesture drivers already know.
 *
 * `index` and `signin` stay chrome-less — they are full-bleed gates, not
 * destinations you navigate back from.
 */
function DriverStack() {
  const colors = useThemeColors();
  const { locale, t } = useI18n();

  return (
    <Stack
      screenOptions={{
        contentStyle: { backgroundColor: colors.bg },
        headerStyle: { backgroundColor: colors.bg },
        // accentText, not accent: the back button is a tinted LABEL, and the
        // fill-tuned teal fails AA as small text on the dark canvas.
        headerTintColor: colors.accentText,
        headerTitleStyle: { color: colors.ink },
        // Native-stack does not expose a safe right-aligned title on iOS.
        // Centering Arabic keeps the title visually balanced on Android and
        // preserves native title/back gestures without forceRTL or a restart.
        headerTitleAlign: locale === 'ar' ? 'center' : undefined,
        headerShadowVisible: false,
        headerBackButtonDisplayMode: 'minimal',
      }}
    >
      <Stack.Screen name="index" options={{ headerShown: false }} />
      <Stack.Screen name="signin" options={{ headerShown: false }} />
      <Stack.Screen
        name="home"
        options={{
          title: t('nav.deliveries'),
          headerLargeTitle: true,
          headerBackVisible: false,
        }}
      />
      <Stack.Screen name="job/[id]" options={{ title: t('nav.delivery') }} />
      <Stack.Screen name="job/[id]/chat" options={{ title: t('nav.chat') }} />
      <Stack.Screen
        name="history"
        options={{ title: t('nav.history'), headerLargeTitle: true }}
      />
      <Stack.Screen name="tier" options={{ title: t('nav.tier') }} />
      <Stack.Screen name="kyc" options={{ title: t('nav.verification') }} />
    </Stack>
  );
}
