import { useEffect } from 'react';
import { Stack } from 'expo-router';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { useCart } from '../src/store/cart';
import { useSession } from '../src/store/session';
import { db, isBackendLive } from '../src/data';
import { initAnalytics } from '../src/lib/analytics';
import { configureNotificationHandler, registerForPush } from '../src/lib/push';
import { syncFavoritesFromServer } from '../src/lib/favorites';

initAnalytics();
configureNotificationHandler();

export default function RootLayout() {
  const hydrateCart = useCart((s) => s.hydrate);
  const hydrateSession = useSession((s) => s.hydrate);

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

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: '#fafaf7' } }}>
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
          <Stack.Screen name="settings" />
          <Stack.Screen name="settings/allergies" />
          <Stack.Screen name="help" />
          <Stack.Screen name="delete-account" />
        </Stack>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
