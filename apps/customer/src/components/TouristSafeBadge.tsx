import { Text, View } from 'react-native';
import { font } from '../theme';
import { makeStyles } from '../themeProvider';
import { useT } from '../i18n';

export function TouristSafeBadge() {
  const styles = useStyles();
  const t = useT();
  return (
    <View style={styles.b}>
      <Text style={styles.star}>★</Text>
      <Text style={styles.t}>{t('home.featuredEyebrowTouristSafe')}</Text>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  b: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.seaSoft,
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 6,
    gap: 4,
  },
  star: { color: colors.sea, fontSize: font.sizes.xs, fontWeight: font.weights.bold },
  t: {
    fontSize: font.sizes.xs,
    fontWeight: font.weights.bold,
    color: colors.sea,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
}));
