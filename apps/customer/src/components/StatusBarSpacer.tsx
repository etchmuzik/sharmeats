import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export function StatusBarSpacer({ minHeight = 44 }: { minHeight?: number }) {
  const insets = useSafeAreaInsets();
  return <View style={{ height: Math.max(insets.top, minHeight) }} />;
}
