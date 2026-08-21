import { useEffect, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BackButton } from '../../src/components/BackButton';
import { RestaurantCard } from '../../src/components/RestaurantCard';
import { SkeletonRestaurantCard } from '../../src/components/SkeletonRestaurantCard';
import { EmptyState } from '../../src/components/EmptyState';
import { ThemedStatusBar, makeStyles } from '../../src/themeProvider';
import { font } from '../../src/theme';
import { db } from '../../src/data';
import type { Restaurant, Vertical, VerticalId } from '../../src/data/types';
import { useT } from '../../src/i18n';
import { useSession } from '../../src/store/session';
import { useDirection } from '../../src/lib/direction';

/**
 * Vertical landing: the merchant list for one non-food vertical (grocery,
 * pharmacy). Category-chip navigation waits until a vertical has enough
 * merchants to need it — with pilot supply this is a straight list.
 */
export default function VerticalLanding() {
  const styles = useStyles();
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const t = useT();
  const locale = useSession((s) => s.locale);
  const dir = useDirection();
  const [vertical, setVertical] = useState<Vertical | null>(null);
  const [merchants, setMerchants] = useState<Restaurant[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!id) return;
    let mounted = true;
    // Resolve the vertical from the user-visible list: a deep link into a
    // vertical this account cannot see resolves null and renders the empty
    // state — indistinguishable from an empty shelf, matching the server's
    // denial behavior for hidden verticals.
    Promise.all([
      db.verticals.list().then((vs) => vs.find((v) => v.id === id) ?? null),
      db.restaurants.list({ verticalId: id as VerticalId }),
    ])
      .then(([v, rs]) => {
        if (mounted) {
          setVertical(v);
          setMerchants(v ? rs : []);
        }
      })
      .catch(() => {
        if (mounted) {
          setVertical(null);
          setMerchants([]);
        }
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, [id]);

  const title = vertical ? (locale === 'ar' ? vertical.nameAr : vertical.nameEn) : '';

  return (
    <View style={styles.screen}>
      <ThemedStatusBar />
      <View style={[styles.nav, dir.row, { paddingTop: insets.top + 6 }]}>
        <BackButton />
        <Text style={[styles.title, dir.text]} numberOfLines={1}>
          {title}
        </Text>
        <View style={{ width: 40 }} />
      </View>
      <ScrollView
        contentContainerStyle={{ padding: 20, gap: 12, paddingBottom: 40 + insets.bottom }}>
        {loading ? (
          [0, 1, 2].map((i) => <SkeletonRestaurantCard key={i} />)
        ) : merchants.length === 0 ? (
          <EmptyState title={t('empty.generic.title')} body={t('browse.empty')} />
        ) : (
          merchants.map((r) => <RestaurantCard key={r.id} restaurant={r} />)
        )}
      </ScrollView>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  screen: { flex: 1, backgroundColor: colors.bg },
  nav: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
    paddingBottom: 10,
  },
  title: {
    flex: 1,
    textAlign: 'center',
    fontSize: font.sizes['2xl'],
    fontWeight: font.weights.bold,
    color: colors.ink,
  },
}));
