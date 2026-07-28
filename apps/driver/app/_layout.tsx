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
        <AuthProvider>
          <ToastProvider>
            <StatusBar style="dark" />
            {/*
              Native headers (large titles + native back) rather than
              hand-rolled ones: they give correct safe-area handling for free via
              `contentInsetAdjustmentBehavior="automatic"` on each screen's
              scroller, and a back gesture drivers already know.

              `index` and `signin` stay chrome-less — they are full-bleed gates,
              not destinations you navigate back from.
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
              <Stack.Screen
                name="home"
                options={{ title: 'Deliveries', headerLargeTitle: true, headerBackVisible: false }}
              />
              <Stack.Screen name="job/[id]" options={{ title: 'Delivery' }} />
              <Stack.Screen name="job/[id]/chat" options={{ title: 'Chat' }} />
              <Stack.Screen name="history" options={{ title: 'History', headerLargeTitle: true }} />
              <Stack.Screen name="tier" options={{ title: 'My tier' }} />
              <Stack.Screen name="kyc" options={{ title: 'Verification' }} />
            </Stack>
          </ToastProvider>
        </AuthProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
