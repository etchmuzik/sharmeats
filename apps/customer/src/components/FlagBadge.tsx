import { Text, View, StyleSheet } from 'react-native';
import { colors, font } from '../theme';
import { useT } from '../i18n';
import type { ItemFlag } from '../data/types';

const COLOR: Record<ItemFlag, { bg: string; fg: string }> = {
  halal: { bg: colors.greenSoft, fg: colors.green },
  vegetarian: { bg: '#e8f5d4', fg: '#4d7a1f' },
  vegan: { bg: '#d6efce', fg: '#2c6a14' },
  contains_pork: { bg: colors.redSoft, fg: colors.red },
  contains_alcohol: { bg: '#fde6c0', fg: colors.amber },
  contains_nuts: { bg: '#f0e0c4', fg: '#8a5d12' },
  spicy: { bg: colors.redSoft, fg: colors.red },
  glutenfree: { bg: colors.seaSoft, fg: colors.sea },
};

export function FlagBadge({ flag }: { flag: ItemFlag }) {
  const t = useT();
  // Egypt is halal by default — no need to badge every dish with it.
  if (flag === 'halal') return null;
  const cfg = COLOR[flag];
  if (!cfg) return null;
  return (
    <View style={[styles.b, { backgroundColor: cfg.bg }]}>
      <Text style={[styles.t, { color: cfg.fg }]}>{t(`flag.${flag}`)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  b: { paddingHorizontal: 7, paddingVertical: 2.5, borderRadius: 5 },
  t: {
    fontSize: 10,
    fontWeight: font.weights.bold,
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
});
