import { Text, View } from 'react-native';
import { font, type Palette } from '../theme';
import { makeStyles, useThemeColors, useThemeScheme } from '../themeProvider';
import { useT } from '../i18n';
import type { ItemFlag } from '../data/types';

/**
 * Badge colors per flag, as a function of the active palette.
 *
 * The three diet flags carry hand-picked greens/ambers rather than palette
 * tokens, because "vegan green" and "contains nuts" are their own signals and
 * the palette has no token for them. Those get an explicit dark variant here
 * for the same reason the tokens do: the light tints are 90%-luminance washes
 * that glow on a dark canvas.
 */
function flagColors(colors: Palette, dark: boolean): Record<ItemFlag, { bg: string; fg: string }> {
  return {
    halal: { bg: colors.greenSoft, fg: colors.green },
    vegetarian: dark ? { bg: '#1E2A12', fg: '#A7CE72' } : { bg: '#e8f5d4', fg: '#4d7a1f' },
    vegan: dark ? { bg: '#16290F', fg: '#8FC46C' } : { bg: '#d6efce', fg: '#2c6a14' },
    contains_pork: { bg: colors.redSoft, fg: colors.red },
    contains_alcohol: dark ? { bg: '#2E2312', fg: colors.amber } : { bg: '#fde6c0', fg: colors.amber },
    contains_nuts: dark ? { bg: '#2B2314', fg: '#D2A855' } : { bg: '#f0e0c4', fg: '#8a5d12' },
    spicy: { bg: colors.redSoft, fg: colors.red },
    glutenfree: { bg: colors.seaSoft, fg: colors.sea },
  };
}

export function FlagBadge({ flag }: { flag: ItemFlag }) {
  const styles = useStyles();
  const colors = useThemeColors();
  const scheme = useThemeScheme();
  const t = useT();
  // Egypt is halal by default — no need to badge every dish with it.
  if (flag === 'halal') return null;
  const cfg = flagColors(colors, scheme === 'dark')[flag];
  if (!cfg) return null;
  return (
    <View style={[styles.b, { backgroundColor: cfg.bg }]}>
      <Text style={[styles.t, { color: cfg.fg }]}>{t(`flag.${flag}`)}</Text>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  b: { paddingHorizontal: 7, paddingVertical: 2.5, borderRadius: 5 },
  t: {
    fontSize: font.sizes.xs,
    fontWeight: font.weights.bold,
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
}));
