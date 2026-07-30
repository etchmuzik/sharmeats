import { useEffect } from 'react';
import { AppState } from 'react-native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AuthProvider } from '../src/auth';
import { ToastProvider } from '../src/components/Toast';
import { colors } from '../src/theme';
import { initCrashReporting } from '../src/lib/crash';
import { getSupabase, isSupabaseConfigured } from '../src/supabase';
import { ScreenErrorBoundary } from '../src/components/ScreenErrorBoundary';
import { LocaleProvider, useLocale } from '../src/locale';

export { ScreenErrorBoundary as ErrorBoundary };

// Boot crash reporting before the tree renders (no-op unless EXPO_PUBLIC_SENTRY_DSN
// is set). The restaurant kiosk runs whole shifts — a silent crash that drops the
// order queue must be reported, so this runs first.
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
        <LocaleProvider>
          <AuthProvider>
            <ToastProvider>
              <RestaurantStack />
            </ToastProvider>
          </AuthProvider>
        </LocaleProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

function RestaurantStack() {
  const { t } = useLocale();

  return (
    <>
      <StatusBar style="dark" />
      {/*
        Native headers (native back + correct safe-area handling via
        `contentInsetAdjustmentBehavior="automatic"`) on every screen a
        user navigates *into*.

        `home` is the exception: its KitchenHeader carries brand identity,
        the open/closed control and the chime toggle — state a title bar
        cannot express, and which must stay pinned above the queue. It
        keeps its own chrome. `index`/`signin` are full-bleed gates.
      */}
      <Stack
        screenOptions={{
          contentStyle: { backgroundColor: colors.bg },
          headerStyle: { backgroundColor: colors.bg },
          headerTintColor: colors.accent,
          headerTitleStyle: { color: colors.ink },
          headerShadowVisible: false,
          headerBackButtonDisplayMode: 'minimal',
        }}
      >
        <Stack.Screen name="index" options={{ headerShown: false }} />
        <Stack.Screen name="signin" options={{ headerShown: false }} />
        <Stack.Screen name="home" options={{ headerShown: false }} />
        <Stack.Screen name="tier" options={{ title: t('nav.tier') }} />
        <Stack.Screen name="menu" options={{ title: t('nav.menu'), headerLargeTitle: true }} />
        <Stack.Screen name="kyc" options={{ title: t('nav.verification') }} />
        <Stack.Screen name="order/[id]" options={{ title: t('nav.order') }} />
        <Stack.Screen name="order/[id]/chat" options={{ title: t('nav.chat') }} />
      </Stack>
    </>
  );
}
