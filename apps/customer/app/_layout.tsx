import { useEffect } from 'react';
import { Stack } from 'expo-router';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { useCart } from '../src/store/cart';
import { useSession } from '../src/store/session';

export default function RootLayout() {
  const hydrateCart = useCart((s) => s.hydrate);
  const hydrateSession = useSession((s) => s.hydrate);

  useEffect(() => {
    hydrateCart();
    hydrateSession();
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
        </Stack>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
