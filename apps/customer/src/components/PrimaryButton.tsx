import { ActivityIndicator, Pressable, Text, ViewStyle, StyleProp } from 'react-native';
import { radius, font } from '../theme';
import { makeStyles, useThemeColors } from '../themeProvider';
import { press } from '../haptics';

type Props = {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'ghost';
  disabled?: boolean;
  loading?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
};

export function PrimaryButton({
  label,
  onPress,
  variant = 'primary',
  disabled,
  loading = false,
  style,
  testID,
}: Props) {
  const colors = useThemeColors();
  const styles = useStyles();
  const isDisabled = Boolean(disabled || loading);
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={isDisabled}
      accessibilityState={{ disabled: isDisabled, busy: loading }}
      onPress={() => {
        press();
        onPress();
      }}
      style={({ pressed }) => [
        styles.base,
        variant === 'primary' && styles.primary,
        variant === 'secondary' && styles.secondary,
        variant === 'ghost' && styles.ghost,
        isDisabled && { opacity: 0.4 },
        pressed && !isDisabled && { opacity: 0.9, transform: [{ scale: 0.985 }] },
        style,
      ]}>
      {loading ? <ActivityIndicator size="small" color={variant === 'primary' ? colors.onAccent : colors.ink} /> : null}
      <Text
        style={[
          styles.label,
          variant === 'primary' && { color: colors.onAccent },
          variant === 'secondary' && { color: colors.ink },
          variant === 'ghost' && { color: colors.ink2 },
        ]}>
        {label}
      </Text>
    </Pressable>
  );
}

const useStyles = makeStyles((colors) => ({
  base: {
    flexDirection: 'row',
    gap: 8,
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
}));
