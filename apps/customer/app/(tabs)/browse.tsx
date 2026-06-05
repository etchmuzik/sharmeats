import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  FlatList,
  Image,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, font, radius } from '../../src/theme';
import { CuisinePill } from '../../src/components/CuisinePill';
import { RestaurantCard } from '../../src/components/RestaurantCard';
import { Icon } from '../../src/components/Icon';
import { db } from '../../src/data';
import type { Cuisine, MenuItem, Restaurant } from '../../src/data/types';
import { useT } from '../../src/i18n';
import { formatEgp } from '../../src/lib/format';
import { tap } from '../../src/haptics';

const CUISINES: { key: Cuisine | 'all'; tKey: string; emoji: string }[] = [
  { key: 'all', tKey: 'cuisine.all', emoji: '' },
  { key: 'breakfast', tKey: 'cuisine.breakfast', emoji: '🍳' },
  { key: 'street_food', tKey: 'cuisine.street_food', emoji: '🥙' },
  { key: 'egyptian', tKey: 'cuisine.egyptian', emoji: '🍲' },
  { key: 'sweets', tKey: 'cuisine.sweets', emoji: '🍯' },
  { key: 'grocery', tKey: 'cuisine.grocery', emoji: '🛒' },
  { key: 'pharmacy', tKey: 'cuisine.pharmacy', emoji: '💊' },
  { key: 'italian', tKey: 'cuisine.italian', emoji: '🍝' },
  { key: 'seafood', tKey: 'cuisine.seafood', emoji: '🐟' },
  { key: 'sushi', tKey: 'cuisine.sushi', emoji: '🍣' },
  { key: 'healthy', tKey: 'cuisine.healthy', emoji: '🥗' },
  { key: 'burgers', tKey: 'cuisine.burgers', emoji: '🍔' },
  { key: 'pizza', tKey: 'cuisine.pizza', emoji: '🍕' },
];

interface MenuMatch {
  item: MenuItem;
  restaurant: Restaurant;
}

// Halal is the default in Egypt — no filter needed. Keep vegetarian + GF only.
const FLAG_FILTERS: { key: 'vegetarian' | 'glutenfree'; tKey: string; emoji: string }[] = [
  { key: 'vegetarian', tKey: 'flag.vegetarian', emoji: '🥬' },
  { key: 'glutenfree', tKey: 'flag.glutenfree', emoji: '🌾' },
];

export default function BrowseTab() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const t = useT();
  const [cuisine, setCuisine] = useState<Cuisine | 'all'>('all');
  const [query, setQuery] = useState('');
  const [all, setAll] = useState<Restaurant[]>([]);
  const [menuMatches, setMenuMatches] = useState<MenuMatch[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [activeFlags, setActiveFlags] = useState<Set<'vegetarian' | 'glutenfree'>>(new Set());
  // Map restaurant id → set of item flags present in that restaurant's menu.
  const [flagsByRestaurant, setFlagsByRestaurant] = useState<Map<string, Set<string>>>(new Map());

  useEffect(() => {
    if (activeFlags.size === 0) return;
    let cancelled = false;
    (async () => {
      const rs = await db.restaurants.list();
      const map = new Map<string, Set<string>>();
      for (const r of rs) {
        const m = await db.menus.forRestaurant(r.id);
        const flags = new Set<string>();
        for (const item of m.items) for (const f of item.flags) flags.add(f);
        map.set(r.id, flags);
      }
      if (!cancelled) setFlagsByRestaurant(map);
    })();
    return () => {
      cancelled = true;
    };
  }, [activeFlags.size]);

  const load = useCallback(async () => {
    const r = await db.restaurants.list();
    setAll(r);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  // Cross-restaurant menu-item search when query is non-empty.
  useEffect(() => {
    const q = query.toLowerCase().trim();
    if (q.length < 2) {
      setMenuMatches([]);
      return;
    }
    let cancelled = false;
    (async () => {
      const rs = await db.restaurants.list();
      const matches: MenuMatch[] = [];
      for (const r of rs) {
        const m = await db.menus.forRestaurant(r.id);
        for (const item of m.items) {
          if (
            item.name.toLowerCase().includes(q) ||
            item.description.toLowerCase().includes(q)
          ) {
            matches.push({ item, restaurant: r });
            if (matches.length >= 12) break;
          }
        }
        if (matches.length >= 12) break;
      }
      if (!cancelled) setMenuMatches(matches);
    })();
    return () => {
      cancelled = true;
    };
  }, [query]);

  const filtered = useMemo(() => {
    const q = query.toLowerCase().trim();
    return all.filter((r) => {
      if (cuisine !== 'all' && !r.cuisines.includes(cuisine as Cuisine)) return false;
      if (activeFlags.size > 0) {
        const rflags = flagsByRestaurant.get(r.id);
        if (!rflags) return false; // not yet indexed
        for (const f of activeFlags) {
          if (!rflags.has(f)) return false;
        }
      }
      if (!q) return true;
      return r.name.toLowerCase().includes(q) || r.cuisineLabel.toLowerCase().includes(q);
    });
  }, [all, cuisine, query, activeFlags, flagsByRestaurant]);

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <StatusBar style="dark" />
      <View style={[styles.top, { paddingTop: insets.top + 14 }]}>
        <Text style={styles.title}>{t('browse.title')}</Text>
        <View style={styles.searchBox}>
          <Icon name="search" size={16} color={colors.ink3} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder={t('home.searchHint')}
            placeholderTextColor={colors.ink3}
            style={styles.input}
            accessibilityLabel={t('home.searchHint')}
          />
        </View>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.cuisineRow}>
          {CUISINES.map((c) => (
            <CuisinePill
              key={c.key}
              label={t(c.tKey)}
              emoji={c.emoji}
              active={cuisine === c.key}
              onPress={() => setCuisine(c.key as Cuisine | 'all')}
            />
          ))}
        </ScrollView>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.flagRow}>
          {FLAG_FILTERS.map((f) => (
            <CuisinePill
              key={f.key}
              label={t(f.tKey)}
              emoji={f.emoji}
              active={activeFlags.has(f.key)}
              onPress={() => {
                setActiveFlags((prev) => {
                  const next = new Set(prev);
                  if (next.has(f.key)) next.delete(f.key);
                  else next.add(f.key);
                  return next;
                });
              }}
            />
          ))}
        </ScrollView>
      </View>

      <FlatList
        data={filtered}
        keyExtractor={(r) => r.id}
        contentContainerStyle={{ padding: 16, paddingBottom: 120 + insets.bottom, gap: 12 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        ListHeaderComponent={
          menuMatches.length > 0 ? (
            <View style={styles.menuMatchWrap}>
              <Text style={styles.menuMatchTitle}>{t('browse.dishes')}</Text>
              {menuMatches.map((m) => (
                <Pressable
                  key={m.item.id}
                  onPress={() => {
                    tap();
                    router.push(`/item/${m.item.id}` as never);
                  }}
                  style={({ pressed }) => [styles.menuRow, pressed && { opacity: 0.85 }]}>
                  <Image source={{ uri: m.item.image }} style={styles.menuImg} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.menuName} numberOfLines={1}>
                      {m.item.name}
                    </Text>
                    <Text style={styles.menuSub} numberOfLines={1}>
                      {m.restaurant.name}
                    </Text>
                  </View>
                  <Text style={styles.menuPrice}>{formatEgp(m.item.priceEgp)}</Text>
                </Pressable>
              ))}
              <Text style={styles.menuMatchTitle}>{t('browse.restaurants')}</Text>
            </View>
          ) : null
        }
        renderItem={({ item }) => <RestaurantCard restaurant={item} />}
        ListEmptyComponent={
          menuMatches.length === 0 ? (
            <View style={{ paddingTop: 60, alignItems: 'center' }}>
              <Text style={{ color: colors.ink3 }}>{t('browse.empty')}</Text>
            </View>
          ) : null
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  top: {
    paddingHorizontal: 20,
    paddingBottom: 6,
    backgroundColor: colors.bg,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  title: {
    fontSize: 32,
    fontWeight: font.weights.extrabold,
    letterSpacing: -0.8,
    color: colors.ink,
  },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.lg,
    paddingHorizontal: 14,
    height: 46,
    marginTop: 14,
  },
  input: { flex: 1, fontSize: font.sizes.lg, color: colors.ink, paddingVertical: 0 },
  cuisineRow: { gap: 8, paddingTop: 14, paddingBottom: 6 },
  flagRow: { gap: 8, paddingTop: 4, paddingBottom: 14 },
  menuMatchWrap: { gap: 6, marginBottom: 14 },
  menuMatchTitle: {
    fontSize: font.sizes.sm,
    color: colors.ink3,
    fontWeight: font.weights.bold,
    letterSpacing: 1,
    textTransform: 'uppercase',
    paddingTop: 10,
    paddingBottom: 4,
  },
  menuRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 8,
    paddingHorizontal: 8,
    borderRadius: radius.md,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.line,
  },
  menuImg: { width: 44, height: 44, borderRadius: radius.md, backgroundColor: colors.bgSoft },
  menuName: { fontSize: font.sizes.lg, color: colors.ink, fontWeight: font.weights.bold },
  menuSub: { fontSize: font.sizes.sm, color: colors.ink2, marginTop: 2 },
  menuPrice: { fontSize: font.sizes.md, color: colors.ink, fontWeight: font.weights.bold },
});
