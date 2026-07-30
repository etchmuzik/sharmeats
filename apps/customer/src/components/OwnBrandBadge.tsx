import { Text, View } from 'react-native';
import { font } from '../theme';
import { makeStyles } from '../themeProvider';
import { useT } from '../i18n';

/**
 * Mandatory disclosure chip for company-owned virtual brands (cloud kitchen).
 *
 * Deliberately NEUTRAL styling — ink on a soft grey, no gold/premium
 * treatment. This is a disclosure, not a promotion: styling it as a badge of
 * quality would convert honesty into self-preferencing and recreate the
 * fairness problem it exists to solve (see the ranking-integrity constraint in
 * migration 126, and CPL 181/2018 on truthful presentation).
 */
export function OwnBrandBadge() {
  const styles = useStyles();
  const t = useT();
  return (
    <View style={styles.b}>
      <Text style={styles.t}>{t('restaurant.ownBrand')}</Text>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  b: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.bgSoft,
    borderWidth: 1,
    borderColor: colors.line,
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 6,
  },
  t: {
    fontSize: font.sizes.xs,
    fontWeight: font.weights.bold,
    color: colors.ink2,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
}));
