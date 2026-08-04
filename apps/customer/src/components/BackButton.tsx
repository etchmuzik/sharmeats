import { StyleSheet } from 'react-native';
import type { Href } from 'expo-router';
import { makeStyles, useThemeColors } from '../themeProvider';
import { useGoBack } from '../lib/navigation';
import { useDirection } from '../lib/direction';
import { Icon } from './Icon';
import { PressableScale } from './PressableScale';
import { GlassControl } from './GlassSurface';

type Props = {
  size?: number;
  onPress?: () => void;
  /** Where to land if there is no screen to pop back to (deep link / first route). */
  fallback?: Href;
  accessibilityLabel?: string;
  tint?: 'dark' | 'light';
  /** Native glass only for controls placed over a photo or live map. */
  material?: 'solid' | 'glass';
};

export function BackButton({
  size = 38,
  onPress,
  fallback,
  accessibilityLabel = 'Go back',
  tint = 'dark',
  material = 'solid',
}: Props) {
  const colors = useThemeColors();
  const styles = useStyles();
  const goBack = useGoBack(fallback);
  const dir = useDirection();
  // Keep the visual circle at `size` but guarantee a >=44pt effective tap target (HIG minimum).
  const slop = Math.max(4, Math.ceil((44 - size) / 2));
  const handlePress = () => {
    if (onPress) onPress();
    else goBack();
  };

  if (material === 'glass') {
    return (
      <GlassControl
        size={size}
        tone={tint === 'light' ? 'light' : 'dark'}
        hitSlop={slop}
        haptic="tap"
        onPress={handlePress}
        accessibilityLabel={accessibilityLabel}>
        <Icon name={dir.isRtl ? 'chevronForward' : 'chevronBack'} size={22} color={colors.ink} />
      </GlassControl>
    );
  }

  return (
    <PressableScale
      haptic="tap"
      hitSlop={slop}
      onPress={handlePress}
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
    </PressableScale>
  );
}

const useStyles = makeStyles((colors) => ({
  btn: { alignItems: 'center', justifyContent: 'center' },
}));
