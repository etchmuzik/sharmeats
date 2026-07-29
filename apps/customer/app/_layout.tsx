import { useEffect } from 'react';
import { AppState } from 'react-native';
import { Stack } from 'expo-router';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { useCart } from '../src/store/cart';
import { useSession } from '../src/store/session';
import { db, isBackendLive } from '../src/data';
import { getSupabase, isSupabaseConfigured } from '../src/data/supabase/client';
import { initAnalytics, track, setAnalyticsContext } from '../src/lib/analytics';
import { configureNotificationHandler, registerForPush, useNotificationRouting } from '../src/lib/push';
import { syncFavoritesFromServer } from '../src/lib/favorites';
import { ScreenErrorBoundary } from '../src/components/ScreenErrorBoundary';
import { ThemeProvider, useThemeColors } from '../src/themeProvider';

// App-wide safety net: any uncaught render error in any route degrades to a
// friendly retry screen (and is reported) instead of white-screening the app.
export { ScreenErrorBoundary as ErrorBoundary };

initAnalytics();
configureNotificationHandler();

export default function RootLayout() {
  const hydrateCart = useCart((s) => s.hydrate);
  const hydrateSession = useSession((s) => s.hydrate);
  const locale = useSession((s) => s.locale);
  const currency = useSession((s) => s.currency);
  const isSignedIn = useSession((s) => s.isSignedIn);
  const hydrated = useSession((s) => s.hydrated);

  // Route notification taps (order updates, chat, support) to the right screen.
  useNotificationRouting();

  // Keep the properties attached to EVERY event in step with the session.
  // Registered centrally so no call site has to remember them, and so
  // analytics.ts never has to import the session store (circular, untestable).
  useEffect(() => {
    setAnalyticsContext({
      locale,
      currency,
      authState: isSignedIn ? 'signed_in' : 'anonymous',
    });
  }, [locale, currency, isSignedIn]);

  // app_opened is the head of the funnel, so it must not fire before the
  // context above is known -- an event with the wrong locale/currency is worse
  // than one that arrives a tick later. Waiting for `hydrated` also means it
  // fires once per launch rather than on every store change.
  useEffect(() => {
    if (!hydrated) return;
    track('app_opened');
  }, [hydrated]);

  useEffect(() => {
    hydrateCart();
    hydrateSession();
    // In live mode, ensure a real Supabase session exists before any screen
    // queries the backend (the server-authority RPCs require auth.uid()).
    // Anonymous sign-in is the zero-friction guest path; failures are logged
    // (not thrown) so the app still renders even if the provider is off.
    if (isBackendLive) {
      db.auth
        .ensureSession()
        .then(() => {
          registerForPush();
          syncFavoritesFromServer();
        })
        .catch((e) => console.warn('[auth] ensureSession failed:', e?.message ?? e));
    }
  }, [hydrateCart, hydrateSession]);

  // Keep the Supabase access token fresh while the app is in the foreground and
  // pause refresh in the background (Supabase's recommended React Native pattern).
  // Pairs with the AsyncStorage adapter in client.ts so the persisted session is
  // both kept and continuously refreshed instead of silently expiring.
  useEffect(() => {
    // Match the ensureSession() effect's resilience: if the backend is off or
    // the Supabase env is incomplete, no-op instead of letting getSupabase()
    // throw synchronously out of this effect (which, with no error boundary
    // above the root layout, would crash the app on launch).
    if (!isBackendLive || !isSupabaseConfigured()) return;
    const sb = getSupabase();
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') sb.auth.startAutoRefresh();
      else sb.auth.stopAutoRefresh();
    });
    if (AppState.currentState === 'active') sb.auth.startAutoRefresh();
    return () => sub.remove();
  }, []);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <ThemeProvider>
          <RootNavigator />
        </ThemeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

/**
 * The navigator lives below ThemeProvider so `contentStyle` can read the active
 * palette. That background is what shows THROUGH during a screen transition and
 * behind an overscroll, so leaving it a hardcoded off-white flashed a white
 * frame on every push in dark mode.
 */
function RootNavigator() {
  const colors = useThemeColors();
  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg } }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="onboarding" />
      <Stack.Screen name="signin" />
      <Stack.Screen name="otp" />
      <Stack.Screen name="(tabs)" />
      <Stack.Screen name="restaurant/[id]" />
      <Stack.Screen name="item/[id]" options={{ presentation: 'modal' }} />
      <Stack.Screen name="checkout" />
      <Stack.Screen name="address/picker" options={{ presentation: 'modal' }} />
      <Stack.Screen name="address/add" options={{ presentation: 'modal' }} />
      <Stack.Screen name="payment/picker" options={{ presentation: 'modal' }} />
      <Stack.Screen name="order/[id]" />
      <Stack.Screen name="order/[id]/review" />
      <Stack.Screen name="order/[id]/chat" />
      <Stack.Screen name="settings" />
      <Stack.Screen name="settings/allergies" />
      <Stack.Screen name="help" />
      <Stack.Screen name="support" />
      <Stack.Screen name="edit-profile" />
      <Stack.Screen name="delete-account" />
    </Stack>
  );
}
