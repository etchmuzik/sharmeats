import { useCallback, useState } from 'react';
import { ActivityIndicator, Image, Pressable, ScrollView, Text, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BackButton } from '../src/components/BackButton';
import { RestaurantCard } from '../src/components/RestaurantCard';
import { font, radius, shadow } from '../src/theme';
import { ThemedStatusBar, makeStyles, useThemeColors } from '../src/themeProvider';
import { useT } from '../src/i18n';
import { db } from '../src/data';
import { useSession } from '../src/store/session';
import { formatEgp } from '../src/lib/format';
import { tap } from '../src/haptics';
import { useFavoriteItem } from '../src/lib/favorites';
import type { Restaurant, SavedItem } from '../src/data/types';

type Tab = 'items' | 'places';

/**
 * Saved — the customer's kept dishes and restaurants.
 *
 * Unavailable dishes and closed restaurants are shown, greyed out, rather than
 * filtered away: a save that silently vanishes reads as a bug, and "it's back"
 * is the main reason to keep a list like this. Only the ADD action is disabled.
 */
export default function Saved() {
  const colors = useThemeColors();
  const styles = useStyles();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const t = useT();
  const [tab, setTab] = useState<Tab>('items');
  const [items, setItems] = useState<SavedItem[]>([]);
  const [places, setPlaces] = useState<Restaurant[]>([]);
  const [loading, setLoading] = useState(true);
  const favoriteIds = useSession((s) => s.favoriteIds);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      setLoading(true);
      Promise.all([
        db.user.listFavoriteItems().catch(() => [] as SavedItem[]),
        // Saved restaurants are resolved from the local id list, which is
        // already merged with the server on launch (see lib/favorites).
        Promise.all(favoriteIds.map((id) => db.restaurants.get(id).catch(() => null))),
      ])
        .then(([savedItems, restaurants]) => {
          if (cancelled) return;
          setItems(savedItems);
          setPlaces(restaurants.filter((r): r is Restaurant => r !== null));
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
      return () => {
        cancelled = true;
      };
    }, [favoriteIds]),
  );

  const empty =
    (tab === 'items' && items.length === 0) || (tab === 'places' && places.length === 0);

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <ThemedStatusBar />
      <View style={[styles.head, { paddingTop: insets.top + 12 }]}>
        <BackButton />
        <Text style={styles.title}>{t('saved.title')}</Text>
        <View style={{ width: 38 }} />
      </View>

      <View style={styles.tabs}>
        {(['items', 'places'] as const).map((key) => {
          const active = tab === key;
          return (
            <Pressable
              key={key}
              onPress={() => {
                tap();
                setTab(key);
              }}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
              style={[styles.tab, active && styles.tabActive]}>
              <Text style={[styles.tabText, active && styles.tabTextActive]}>
                {t(key === 'items' ? 'saved.itemsTab' : 'saved.placesTab')}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.accent} />
        </View>
      ) : empty ? (
        <View style={styles.center}>
          <Text style={styles.emptyTitle}>
            {t(tab === 'items' ? 'saved.emptyItems' : 'saved.emptyPlaces')}
          </Text>
          <Text style={styles.emptyHint}>
            {t(tab === 'items' ? 'saved.emptyItemsHint' : 'saved.emptyPlacesHint')}
          </Text>
          <Pressable
            onPress={() => {
              tap();
              router.push('/(tabs)/browse');
            }}
            style={styles.browseBtn}>
            <Text style={styles.browseText}>{t('saved.browse')}</Text>
          </Pressable>
        </View>
      ) : (
        <ScrollView contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 40 + insets.bottom }}>
          {tab === 'items'
            ? items.map((item) => <SavedItemRow key={item.menuItemId} item={item} />)
            : places.map((r) => <RestaurantCard key={r.id} restaurant={r} />)}
        </ScrollView>
      )}
    </View>
  );
}

function SavedItemRow({ item }: { item: SavedItem }) {
  const styles = useStyles();
  const router = useRouter();
  const t = useT();
  const { toggle } = useFavoriteItem(item.menuItemId, item.restaurantId);
  // "Can I order this right now?" is item availability AND the restaurant being
  // open and active. Any of those false means we show it, dimmed, with the
  // reason — never hide it.
  const orderable = item.isAvailable && item.restaurantIsOpen && item.restaurantIsActive;
  const reason = !item.isAvailable
    ? t('saved.unavailable')
    : !item.restaurantIsOpen || !item.restaurantIsActive
      ? t('saved.restaurantClosed')
      : null;

  return (
    <Pressable
      onPress={() => {
        tap();
        router.push(`/item/${item.menuItemId}`);
      }}
      style={[styles.row, !orderable && styles.rowDim]}>
      {item.image ? (
        <Image source={{ uri: item.image }} style={styles.thumb} />
      ) : (
        <View style={[styles.thumb, styles.thumbEmpty]} />
      )}
      <View style={{ flex: 1 }}>
        <Text style={styles.itemName} numberOfLines={1}>
          {item.name}
        </Text>
        <Text style={styles.itemMeta} numberOfLines={1}>
          {item.restaurantName}
        </Text>
        {reason ? <Text style={styles.itemReason}>{reason}</Text> : null}
      </View>
      <View style={styles.rowRight}>
        <Text style={styles.itemPrice}>{formatEgp(item.priceEgp)}</Text>
        <Pressable
          onPress={() => {
            tap();
            toggle();
          }}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel={t('saved.removeItem')}>
          <Text style={styles.heart}>♥</Text>
        </Pressable>
      </View>
    </Pressable>
  );
}

const useStyles = makeStyles((colors) => ({
  head: {
    paddingHorizontal: 16,
    paddingBottom: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.bg,
  },
  title: {
    fontSize: font.sizes['5xl'],
    fontWeight: font.weights.extrabold,
    letterSpacing: -0.4,
    color: colors.ink,
  },
  tabs: { flexDirection: 'row', gap: 8, paddingHorizontal: 16, paddingBottom: 8 },
  tab: {
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
  },
  tabActive: { backgroundColor: colors.accent, borderColor: colors.accent },
  tabText: { fontSize: font.sizes.lg, fontWeight: font.weights.bold, color: colors.ink2 },
  tabTextActive: { color: colors.onAccent },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 8 },
  emptyTitle: { fontSize: font.sizes['2xl'], fontWeight: font.weights.bold, color: colors.ink },
  emptyHint: { fontSize: font.sizes.lg, color: colors.ink3, textAlign: 'center' },
  browseBtn: {
    marginTop: 12,
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: radius.pill,
    backgroundColor: colors.accent,
  },
  browseText: { color: colors.onAccent, fontWeight: font.weights.bold, fontSize: font.sizes.lg },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.line,
    padding: 12,
    ...shadow.soft,
  },
  // Dimmed, not hidden: the dish is still saved, just not orderable now.
  rowDim: { opacity: 0.55 },
  thumb: { width: 64, height: 64, borderRadius: radius.md, backgroundColor: colors.line2 },
  thumbEmpty: { backgroundColor: colors.line2 },
  itemName: { fontSize: font.sizes.xl, fontWeight: font.weights.bold, color: colors.ink },
  itemMeta: { fontSize: font.sizes.md, color: colors.ink3, marginTop: 2 },
  itemReason: { fontSize: font.sizes.md, color: colors.accent, marginTop: 4, fontWeight: font.weights.bold },
  rowRight: { alignItems: 'flex-end', gap: 8 },
  itemPrice: { fontSize: font.sizes.lg, fontWeight: font.weights.extrabold, color: colors.ink },
  heart: { fontSize: 20, color: colors.accent },
}));
