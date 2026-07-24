import { Pressable, Text, StyleSheet, ViewStyle, StyleProp } from 'react-native';
import { colors, radius, font } from '../theme';
import { press } from '../haptics';

type Props = {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'ghost';
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
};

export function PrimaryButton({
  label,
  onPress,
  variant = 'primary',
  disabled,
  style,
  testID,
}: Props) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      onPress={() => {
        press();
        onPress();
      }}
      style={({ pressed }) => [
        styles.base,
        variant === 'primary' && styles.primary,
        variant === 'secondary' && styles.secondary,
        variant === 'ghost' && styles.ghost,
        disabled && { opacity: 0.4 },
        pressed && !disabled && { opacity: 0.9, transform: [{ scale: 0.985 }] },
        style,
      ]}>
      <Text
        style={[
          styles.label,
          variant === 'primary' && { color: colors.white },
          variant === 'secondary' && { color: colors.ink },
          variant === 'ghost' && { color: colors.ink2 },
        ]}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    paddingVertical: 16,
    paddingHorizontal: 24,
    borderRadius: radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primary: { backgroundColor: colors.accent },
  secondary: { backgroundColor: colors.sand },
  ghost: { backgroundColor: 'transparent', borderWidth: 1.5, borderColor: colors.line },
  label: { fontSize: font.sizes.xl, fontWeight: font.weights.bold },
});
