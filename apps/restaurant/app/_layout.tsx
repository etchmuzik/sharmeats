import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AuthProvider } from '../src/auth';
import { ToastProvider } from '../src/components/Toast';
import { colors } from '../src/theme';
import { initCrashReporting } from '../src/lib/crash';

// Boot crash reporting before the tree renders (no-op unless EXPO_PUBLIC_SENTRY_DSN
// is set). The restaurant kiosk runs whole shifts — a silent crash that drops the
// order queue must be reported, so this runs first.
initCrashReporting();

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <AuthProvider>
          <ToastProvider>
            <StatusBar style="dark" />
            <Stack
              screenOptions={{
                headerShown: false,
                contentStyle: { backgroundColor: colors.bg },
              }}
            >
              <Stack.Screen name="index" />
              <Stack.Screen name="signin" />
              <Stack.Screen name="home" />
              <Stack.Screen name="tier" />
              <Stack.Screen name="menu" />
              <Stack.Screen name="kyc" />
              <Stack.Screen name="order/[id]" />
              <Stack.Screen name="order/[id]/chat" />
            </Stack>
          </ToastProvider>
        </AuthProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
