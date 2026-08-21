import { Slot } from 'expo-router';
import { View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { TabBar } from '../../src/components/TabBar';
import { ActiveOrderBanner } from '../../src/components/ActiveOrderBanner';
import { TermsConsentGate } from '../../src/components/TermsConsentGate';
import { useThemeColors } from '../../src/themeProvider';

export default function TabsLayout() {
  const colors = useThemeColors();
  const insets = useSafeAreaInsets();
  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <Slot />
      {/* Fade the ground behind the floating pill so mid-scroll content dims
          out instead of running fully opaque under the bar. The 8-digit hex is
          the bg token with 00 alpha — both palettes use 6-digit hexes. */}
      <LinearGradient
        pointerEvents="none"
        colors={[`${colors.bg}00`, colors.bg]}
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: 0,
          height: Math.max(insets.bottom, 14) + 84,
        }}
      />
      <ActiveOrderBanner />
      <TabBar />
      {/* Versioned ToS consent checkpoint — overlays the app for a signed-in
          user whose recorded acceptance is missing/stale; no-op otherwise. */}
      <TermsConsentGate />
    </View>
  );
}
