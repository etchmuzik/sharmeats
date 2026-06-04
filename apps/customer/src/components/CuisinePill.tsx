import { Pressable, Text, StyleSheet } from 'react-native';
import { colors, radius, font } from '../theme';
import { selection } from '../haptics';

type Props = {
  label: string;
  emoji?: string;
  active?: boolean;
  onPress: () => void;
};

export function CuisinePill({ label, emoji, active, onPress }: Props) {
  return (
    <Pressable
      onPress={() => {
        selection();
        onPress();
      }}
      style={[styles.pill, active && styles.active]}>
      <Text style={[styles.label, active && styles.labelActive]}>
        {emoji ? `${emoji} ${label}` : label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  pill: {
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.line,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: radius.pill,
  },
  active: { backgroundColor: colors.ink, borderColor: colors.ink },
  label: { fontSize: font.sizes.md, fontWeight: font.weights.semibold, color: colors.ink },
  labelActive: { color: colors.white },
});
