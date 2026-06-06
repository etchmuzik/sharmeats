import { Pressable, StyleSheet } from 'react-native';
import type { Href } from 'expo-router';
import { colors } from '../theme';
import { tap } from '../haptics';
import { useGoBack } from '../lib/navigation';
import { useDirection } from '../lib/direction';
import { Icon } from './Icon';

type Props = {
  size?: number;
  onPress?: () => void;
  /** Where to land if there is no screen to pop back to (deep link / first route). */
  fallback?: Href;
  accessibilityLabel?: string;
  tint?: 'dark' | 'light';
};

export function BackButton({ size = 38, onPress, fallback, accessibilityLabel = 'Go back', tint = 'dark' }: Props) {
  const goBack = useGoBack(fallback);
  const dir = useDirection();
  return (
    <Pressable
      onPress={() => {
        tap();
        if (onPress) onPress();
        else goBack();
      }}
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      style={[
        styles.btn,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: tint === 'dark' ? colors.sand : 'rgba(255,255,255,0.95)',
        },
      ]}>
      {/* Chevron points toward "back" in the current reading direction. */}
      <Icon name={dir.isRtl ? 'chevronForward' : 'chevronBack'} size={22} color={colors.ink} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  btn: { alignItems: 'center', justifyContent: 'center' },
});
