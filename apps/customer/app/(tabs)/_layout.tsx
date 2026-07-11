import { Slot } from 'expo-router';
import { View } from 'react-native';
import { TabBar } from '../../src/components/TabBar';
import { ActiveOrderBanner } from '../../src/components/ActiveOrderBanner';
import { TermsConsentGate } from '../../src/components/TermsConsentGate';
import { colors } from '../../src/theme';

export default function TabsLayout() {
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
