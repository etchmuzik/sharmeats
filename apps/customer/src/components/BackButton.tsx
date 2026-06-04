import { Pressable, Text, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { colors } from '../theme';
import { tap } from '../haptics';

type Props = {
  size?: number;
  onPress?: () => void;
  accessibilityLabel?: string;
  tint?: 'dark' | 'light';
};

export function BackButton({ size = 38, onPress, accessibilityLabel = 'Go back', tint = 'dark' }: Props) {
  const router = useRouter();
  return (
    <Pressable
      onPress={() => {
        tap();
        if (onPress) onPress();
        else router.back();
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
      <Text style={[styles.arrow, { color: tint === 'dark' ? colors.ink : colors.ink }]}>←</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  btn: { alignItems: 'center', justifyContent: 'center' },
  arrow: { fontSize: 18, marginTop: -1 },
});
