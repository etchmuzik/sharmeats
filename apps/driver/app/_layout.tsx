import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AuthProvider } from '../src/auth';
import { ToastProvider } from '../src/components/Toast';
import { colors } from '../src/theme';
import { initCrashReporting } from '../src/lib/crash';

// Boot crash reporting before the tree renders (no-op unless EXPO_PUBLIC_SENTRY_DSN
// is set). The driver app runs unattended mid-delivery — a silent crash is the
// worst blind spot, so this runs first.
initCrashReporting();

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <AuthProvider>
          <ToastProvider>
            <StatusBar style="light" />
            <Stack
              screenOptions={{
                headerShown: false,
                contentStyle: { backgroundColor: colors.bg },
              }}
            >
              <Stack.Screen name="index" />
              <Stack.Screen name="signin" />
              <Stack.Screen name="home" />
              <Stack.Screen name="job/[id]" />
              <Stack.Screen name="job/[id]/chat" />
              <Stack.Screen name="history" />
              <Stack.Screen name="tier" />
              <Stack.Screen name="kyc" />
            </Stack>
          </ToastProvider>
        </AuthProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
