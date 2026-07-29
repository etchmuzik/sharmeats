/**
 * Appearance control: cycles System → Light → Dark on tap.
 *
 * WHY A MANUAL OVERRIDE AT ALL, when the app already follows the OS: a driver
 * works across the full daylight range in one shift. Direct Sharm sun makes the
 * dark theme hard to read even at full brightness, and a late-evening handoff
 * makes the light theme a flashbang. Neither is a device-wide preference the
 * rider wants to renegotiate in Settings while holding a bike — so the override
 * lives one tap from the deliveries screen.
 *
 * There is no Settings screen in this app to host a three-way picker, hence a
 * cycling button. The icon alone carries the state, so it is labelled for
 * screen readers with both the current mode and what tapping does.
 */
import { Pressable, Text, View } from 'react-native';
import { font, radius, spacing } from '../theme';
import { useThemeColors, useThemeMode, type ThemeMode } from '../themeProvider';
import { Icon, type IconName } from './Icon';
import { selection } from '../lib/haptics';

const PRESENTATION: Record<ThemeMode, { icon: IconName; label: string }> = {
  system: { icon: 'themeAuto', label: 'Auto' },
  light: { icon: 'themeLight', label: 'Light' },
  dark: { icon: 'themeDark', label: 'Dark' },
};

/** Order must match the provider's cycle so the hint names the right next step. */
const NEXT: Record<ThemeMode, ThemeMode> = {
  system: 'light',
  light: 'dark',
  dark: 'system',
};

export function ThemeToggle() {
  const colors = useThemeColors();
  const { mode, cycleMode } = useThemeMode();
  const current = PRESENTATION[mode];

  return (
    <Pressable
      onPress={() => {
        selection();
        cycleMode();
      }}
      accessibilityRole="button"
      accessibilityLabel={`Appearance: ${current.label}`}
      accessibilityHint={`Switches to ${PRESENTATION[NEXT[mode]].label}`}
      hitSlop={8}
      style={({ pressed }) => ({
        // 44pt minimum: pressed one-handed, often with a glove on.
        minHeight: 44,
        minWidth: 44,
        paddingHorizontal: spacing.sm,
        borderRadius: radius.pill,
        borderWidth: 1,
        borderColor: colors.line,
        backgroundColor: colors.surface,
        alignItems: 'center',
        justifyContent: 'center',
        gap: 2,
        opacity: pressed ? 0.6 : 1,
      })}
    >
      <View style={{ alignItems: 'center', gap: 1 }}>
        <Icon name={current.icon} size={16} color={colors.accentText} />
        <Text style={{ fontSize: font.sizes.xs, fontWeight: '700', color: colors.ink2 }}>
          {current.label}
        </Text>
      </View>
    </Pressable>
  );
}
