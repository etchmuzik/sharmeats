import { Slot } from 'expo-router';
import { View } from 'react-native';
import { TabBar } from '../../src/components/TabBar';
import { ActiveOrderBanner } from '../../src/components/ActiveOrderBanner';
import { TermsConsentGate } from '../../src/components/TermsConsentGate';
import { useThemeColors } from '../../src/themeProvider';

export default function TabsLayout() {
  const colors = useThemeColors();
  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <Slot />
      <ActiveOrderBanner />
      <TabBar />
      {/* Versioned ToS consent checkpoint — overlays the app for a signed-in
          user whose recorded acceptance is missing/stale; no-op otherwise. */}
      <TermsConsentGate />
    </View>
  );
}
