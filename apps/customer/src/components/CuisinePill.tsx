import { Text } from 'react-native';
import { radius, font } from '../theme';
import { makeStyles } from '../themeProvider';
import { PressableScale } from './PressableScale';

type Props = {
  label: string;
  emoji?: string;
  active?: boolean;
  onPress: () => void;
};

export function CuisinePill({ label, emoji, active, onPress }: Props) {
  const styles = useStyles();
  return (
    <PressableScale
      haptic="selection"
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: Boolean(active) }}
      style={[styles.pill, active && styles.active]}>
      <Text style={[styles.label, active && styles.labelActive]}>
        {emoji ? `${emoji} ${label}` : label}
      </Text>
    </PressableScale>
  );
}

const useStyles = makeStyles((colors) => ({
  pill: {
    minHeight: 44,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: radius.pill,
    justifyContent: 'center',
  },
  active: { backgroundColor: colors.ink, borderColor: colors.ink },
  label: { fontSize: font.sizes.md, fontWeight: font.weights.semibold, color: colors.ink },
  labelActive: { color: colors.onInk },
}));
