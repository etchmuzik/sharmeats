import { useEffect, useState, type ReactNode } from 'react';
import {
  AccessibilityInfo,
  Platform,
  View,
  type PressableProps,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import {
  GlassView,
  isGlassEffectAPIAvailable,
  isLiquidGlassAvailable,
} from 'expo-glass-effect';
import { shadow } from '../theme';
import { makeStyles, useThemeScheme } from '../themeProvider';
import {
  glassEffectStyleForRole,
  shouldUseNativeGlass,
  type GlassSurfaceRole,
} from '../lib/glassMaterial';
import { PressableScale, type HapticKind } from './PressableScale';

type GlassTone = 'light' | 'dark';

type GlassSurfaceProps = {
  children: ReactNode;
  tone?: GlassTone;
  interactive?: boolean;
  role?: GlassSurfaceRole;
  style?: StyleProp<ViewStyle>;
};

type GlassControlProps = {
  children: ReactNode;
  onPress: NonNullable<PressableProps['onPress']>;
  accessibilityLabel: string;
  accessibilityHint?: string;
  accessibilityState?: PressableProps['accessibilityState'];
  disabled?: boolean;
  haptic?: HapticKind;
  hitSlop?: PressableProps['hitSlop'];
  size?: number;
  tone?: GlassTone;
  style?: StyleProp<ViewStyle>;
  testID?: string;
};

type GlassActionDockProps = {
  children: ReactNode;
  onPress: NonNullable<PressableProps['onPress']>;
  accessibilityLabel: string;
  accessibilityHint?: string;
  accessibilityState?: PressableProps['accessibilityState'];
  accessibilityValue?: PressableProps['accessibilityValue'];
  disabled?: boolean;
  haptic?: HapticKind;
  style?: StyleProp<ViewStyle>;
  testID?: string;
};

/**
 * Reads the system accessibility preference before enabling translucency.
 * Starting from `true` avoids flashing glass for someone who has explicitly
 * requested a solid interface while the native value resolves.
 */
function useReduceTransparency(): boolean {
  const [reducedTransparency, setReducedTransparency] = useState(true);

  useEffect(() => {
    if (Platform.OS !== 'ios') return;

    let active = true;
    AccessibilityInfo.isReduceTransparencyEnabled()
      .then((value) => {
        if (active) setReducedTransparency(value);
      })
      .catch(() => {});

    const subscription = AccessibilityInfo.addEventListener(
      'reduceTransparencyChanged',
      setReducedTransparency,
    );
    return () => {
      active = false;
      subscription.remove();
    };
  }, []);

  return reducedTransparency;
}

function nativeGlassIsAvailable(reduceTransparency: boolean): boolean {
  try {
    return shouldUseNativeGlass({
      platform: Platform.OS,
      liquidGlassAvailable: isLiquidGlassAvailable(),
      glassEffectAPIAvailable: isGlassEffectAPIAvailable(),
      reduceTransparency,
    });
  } catch {
    // A native capability probe must never keep an important control from
    // rendering. The solid material still delivers the same affordance.
    return false;
  }
}

/**
 * A deliberately small material surface for controls that sit on photos, a
 * live map, or a primary dock floating over scrolling content. It is not for
 * general app cards: those retain the warm opaque system surface so text and
 * forms stay calm and legible.
 */
export function GlassSurface({
  children,
  tone,
  interactive = false,
  role = 'overlayControl',
  style,
}: GlassSurfaceProps) {
  const styles = useStyles();
  const scheme = useThemeScheme();
  const reducedTransparency = useReduceTransparency();
  const useNativeGlass = nativeGlassIsAvailable(reducedTransparency);
  // Most surfaces follow the selected app theme. Photo/map overlays explicitly
  // request a light material because it keeps the control legible over varied
  // imagery in either app theme.
  const resolvedTone = tone ?? scheme;
  const toneStyle = resolvedTone === 'light' ? styles.light : styles.dark;
  const fallbackStyle = resolvedTone === 'light' ? styles.fallbackLight : styles.fallbackDark;

  if (useNativeGlass) {
    return (
      <GlassView
        colorScheme={resolvedTone}
        glassEffectStyle={glassEffectStyleForRole(role)}
        isInteractive={interactive}
        style={[styles.base, toneStyle, style]}>
        {children}
      </GlassView>
    );
  }

  return <View style={[styles.base, fallbackStyle, style]}>{children}</View>;
}

/** A haptic, accessible control that gains native Liquid Glass where supported. */
export function GlassControl({
  children,
  onPress,
  accessibilityLabel,
  accessibilityHint,
  accessibilityState,
  disabled = false,
  haptic = 'tap',
  hitSlop,
  size = 44,
  tone,
  style,
  testID,
}: GlassControlProps) {
  const styles = useStyles();
  return (
    <GlassSurface
      tone={tone}
      interactive={!disabled}
      style={[styles.control, { width: size, height: size, borderRadius: size / 2 }, style]}>
      <PressableScale
        testID={testID}
        haptic={haptic}
        hitSlop={hitSlop}
        onPress={onPress}
        disabled={disabled}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        accessibilityHint={accessibilityHint}
        accessibilityState={{ ...accessibilityState, disabled }}
        style={[styles.pressable, { borderRadius: size / 2 }, disabled && styles.disabled]}>
        <View pointerEvents="none">{children}</View>
      </PressableScale>
    </GlassSurface>
  );
}

/**
 * A high-emphasis, floating action dock. This intentionally has a denser
 * material than compact photo/map controls, and should only be used when the
 * action stays visible while content scrolls beneath it.
 */
export function GlassActionDock({
  children,
  onPress,
  accessibilityLabel,
  accessibilityHint,
  accessibilityState,
  accessibilityValue,
  disabled = false,
  haptic = 'tap',
  style,
  testID,
}: GlassActionDockProps) {
  const styles = useStyles();
  return (
    <GlassSurface tone="dark" role="actionDock" interactive={!disabled} style={style}>
      <PressableScale
        testID={testID}
        haptic={haptic}
        scaleTo={0.985}
        onPress={onPress}
        disabled={disabled}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        accessibilityHint={accessibilityHint}
        accessibilityValue={accessibilityValue}
        accessibilityState={{ ...accessibilityState, disabled }}
        style={[styles.actionDockPressable, disabled && styles.disabled]}>
        <View pointerEvents="none" style={styles.actionDockContent}>
          {children}
        </View>
      </PressableScale>
    </GlassSurface>
  );
}

const useStyles = makeStyles((colors) => ({
  base: {
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    borderWidth: 1,
    ...shadow.soft,
  },
  light: { borderColor: 'rgba(255,253,250,0.7)' },
  dark: { borderColor: 'rgba(20,18,16,0.5)' },
  fallbackLight: { backgroundColor: colors.surface, borderColor: colors.line },
  fallbackDark: { backgroundColor: colors.inkDeep, borderColor: colors.line2 },
  control: { alignSelf: 'flex-start' },
  pressable: { flex: 1, alignSelf: 'stretch', alignItems: 'center', justifyContent: 'center' },
  actionDockPressable: { alignSelf: 'stretch' },
  actionDockContent: { minHeight: 56, alignSelf: 'stretch' },
  disabled: { opacity: 0.45 },
}));
