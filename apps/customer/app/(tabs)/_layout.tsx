import { Slot } from 'expo-router';
import { View } from 'react-native';
import { TabBar } from '../../src/components/TabBar';
import { ActiveOrderBanner } from '../../src/components/ActiveOrderBanner';

export default function TabsLayout() {
  return (
    <View style={{ flex: 1, backgroundColor: '#fafaf7' }}>
      <Slot />
      <ActiveOrderBanner />
      <TabBar />
    </View>
  );
}
