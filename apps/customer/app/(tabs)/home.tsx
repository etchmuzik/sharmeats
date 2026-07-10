import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  FlatList,
  Image,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, font, radius, shadow } from '../../src/theme';
import { CuisinePill } from '../../src/components/CuisinePill';
import { RestaurantCard } from '../../src/components/RestaurantCard';
import { Icon } from '../../src/components/Icon';
import { db } from '../../src/data';
import type { Cuisine, Restaurant, Address, Hotel, Order, SavedOrder } from '../../src/data/types';
import { useT } from '../../src/i18n';
import { useDirection } from '../../src/lib/direction';
import { useSession } from '../../src/store/session';
import { useCart } from '../../src/store/cart';
import { tap } from '../../src/haptics';
import { track } from '../../src/lib/analytics';

/**
 * Same predicate used in orders.tsx (Task 5): a saved-order line is unresolvable
 * if any modifier choice lacks an optionId (pre-mig-055 snapshots). Loading such
 * a line into the cart would silently drop the modifier and misprice the order.
 */
function hasUnresolvableMods(items: { modifierChoices?: { optionId?: string }[] }[]): boolean {
  return items.some((it) => (it.modifierChoices ?? []).some((c) => !c.optionId));
}

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
  { key: 'burgers', tKey: 'cuisine.burgers', emoji: '🍔' },
];

type TimeOfDay = 'morning' | 'lunch' | 'evening' | 'late_night' | 'iftar';

/**
 * Stub Ramadan window. Replace with a real Hijri calendar lookup before launch.
 * Ramadan 1447 AH ≈ 2026-02-17 to 2026-03-18 (UTC). The check is intentionally
 * imprecise — within ±1 day is fine for greeting purposes.
 */
function isRamadan(now: Date): boolean {
  const t = now.getTime();
  const start = Date.UTC(2026, 1, 17);
  const end = Date.UTC(2026, 2, 19);
  return t >= start && t <= end;
}

function timeOfDay(): TimeOfDay {
  const now = new Date();
  const h = now.getHours();
  // Iftar window: sunset → 8pm during Ramadan. Sunset proxy = 18:00 in Sharm.
  if (isRamadan(now) && h >= 18 && h < 20) return 'iftar';
  if (h >= 5 && h < 11) return 'morning';
  if (h >= 11 && h < 16) return 'lunch';
  if (h >= 16 && h < 22) return 'evening';
  return 'late_night';
}

export default function HomeTab() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const t = useT();
  const dir = useDirection();
  const phone = useSession((s) => s.phone);
  const selectedAddressId = useSession((s) => s.selectedAddressId);
  const allergyNudgeDismissed = useSession((s) => s.allergyNudgeDismissed);
  const dismissAllergyNudge = useSession((s) => s.dismissAllergyNudge);
  const [showAllergyNudge, setShowAllergyNudge] = useState(false);
  const [firstName, setFirstName] = useState<string>('');

  useEffect(() => {
    db.user.getMe().then((u) => {
      // First name for the greeting (skip the placeholder "Guest").
      const name = (u.displayName ?? '').trim().split(/\s+/)[0];
      setFirstName(name && name.toLowerCase() !== 'guest' ? name : '');
      if (!allergyNudgeDismissed) {
        setShowAllergyNudge((u.allergyProfile?.length ?? 0) === 0);
      } else {
        setShowAllergyNudge(false);
      }
    });
  }, [allergyNudgeDismissed]);

  const [selectedCuisine, setSelectedCuisine] = useState<Cuisine | 'all'>('all');
  const [featured, setFeatured] = useState<Restaurant[]>([]);
  const [restaurants, setRestaurants] = useState<Restaurant[]>([]);
  const [reorderRail, setReorderRail] = useState<Restaurant[]>([]);
  const [allForRails, setAllForRails] = useState<Restaurant[]>([]);
  const favoriteIds = useSession((s) => s.favoriteIds);
  const [address, setAddress] = useState<Address | null>(null);
  const [hotel, setHotel] = useState<Hotel | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [savedOrders, setSavedOrders] = useState<SavedOrder[]>([]);
  const loadFromOrder = useCart((s) => s.loadFromOrder);

  useEffect(() => {
    db.savedOrders.list().then(setSavedOrders).catch(() => setSavedOrders([]));
  }, []);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    const [feat, list] = await Promise.all([
      db.restaurants.listFeatured(),
      db.restaurants.list(selectedCuisine === 'all' ? undefined : { cuisine: selectedCuisine }),
    ]);
    setFeatured(feat);
    setRestaurants(list);
    setRefreshing(false);
  }, [selectedCuisine]);

  useEffect(() => {
    db.restaurants.listFeatured().then(setFeatured);
    // Unfiltered catalog backs the offers + favourites rails — deals and saved
    // venues stay visible regardless of the cuisine filter.
    db.restaurants.list().then(setAllForRails);
  }, []);

  const offers = useMemo(() => allForRails.filter((r) => !!r.promo), [allForRails]);
  const favoriteRail = useMemo(
    () => allForRails.filter((r) => favoriteIds.includes(r.id)),
    [allForRails, favoriteIds],
  );

  useEffect(() => {
    db.orders.listPast().then(async (past: Order[]) => {
      const seen = new Set<string>();
      const ids: string[] = [];
      for (const o of past) {
        if (!seen.has(o.restaurantId)) {
          seen.add(o.restaurantId);
          ids.push(o.restaurantId);
        }
        if (ids.length >= 3) break;
      }
      const venues = (
        await Promise.all(ids.map((id) => db.restaurants.get(id)))
      ).filter((r): r is Restaurant => !!r);
      setReorderRail(venues);
    });
  }, []);

  const openSaved = (s: SavedOrder) => {
    tap();
    if (hasUnresolvableMods(s.items)) {
      router.push(`/restaurant/${s.restaurantId}` as never);
      return;
    }
    loadFromOrder({ restaurantId: s.restaurantId, restaurantName: s.restaurantName, lines: s.items });
    router.push('/(tabs)/cart');
  };

  const removeSaved = (s: SavedOrder) => {
    Alert.alert(t('savedOrder.removeConfirm'), '', [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('savedOrder.remove'),
        style: 'destructive',
        onPress: () => {
          db.savedOrders.remove(s.id).then(() => setSavedOrders((prev) => prev.filter((x) => x.id !== s.id)));
        },
      },
    ]);
  };

  useEffect(() => {
    db.restaurants
      .list(selectedCuisine === 'all' ? undefined : { cuisine: selectedCuisine })
      .then(setRestaurants);
  }, [selectedCuisine]);

  useEffect(() => {
    if (!selectedAddressId) {
      setAddress(null);
      return;
    }
    db.user.listAddresses().then((addrs) => {
      const a = addrs.find((x) => x.id === selectedAddressId) ?? addrs[0] ?? null;
      setAddress(a);
      if (a?.hotelId) db.hotels.get(a.hotelId).then(setHotel);
      else setHotel(null);
    });
  }, [selectedAddressId]);

  const tod = timeOfDay();
  const greetingKey =
    tod === 'iftar'
      ? 'home.greetingIftar'
      : tod === 'morning'
        ? 'home.greetingMorning'
        : tod === 'lunch' || tod === 'evening'
          ? 'home.greetingEvening'
          : 'home.greetingLateNight';
  const greetingSubKey = tod === 'iftar' ? 'home.greetingSubIftar' : 'home.greetingSub';
  const featuredKey =
    tod === 'iftar' || tod === 'evening'
      ? 'home.featuredEvening'
      : tod === 'morning'
        ? 'home.featuredMorning'
        : tod === 'lunch'
          ? 'home.featuredLunch'
          : 'home.featuredLateNight';

  const addrText =
    address?.kind === 'hotel'
      ? `${hotel?.name ?? address.hotelName ?? t('address.hotel')} · ${t('address.room')} ${address.roomNumber ?? '-'}`
      : address?.kind === 'street'
        ? `${address.streetText ?? t('address.title')} ${address.building ?? ''}`.trim()
        : address?.kind === 'beach_pin'
          ? `${address.beachName ?? t('address.beachPin')}`
          : t('address.chooseAddress');

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <StatusBar style="dark" />
      <ScrollView
        contentContainerStyle={{ paddingBottom: 120 + insets.bottom }}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}>
        <View style={[styles.top, { paddingTop: insets.top + 12 }]}>
          <View style={[styles.addrRow, dir.row]}>
            <Pressable
              onPress={() => {
                tap();
                router.push('/address/picker');
              }}
              accessibilityRole="button"
              accessibilityLabel={`${t('home.deliverTo')}: ${addrText}`}
              style={[styles.addrLeft, dir.row]}>
              <View style={styles.addrIco}>
                <Icon name="location" size={18} color={colors.sea} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.addrLbl}>{t('home.deliverTo')}</Text>
                <View style={styles.addrNameRow}>
                  <Text style={styles.addrName} numberOfLines={1}>
                    {addrText}
                  </Text>
                  <Icon name="chevronDown" size={14} color={colors.ink3} />
                </View>
              </View>
            </Pressable>
            <Pressable
              onPress={() => router.push('/(tabs)/profile')}
              style={styles.avatar}
              accessibilityRole="button"
              accessibilityLabel={t('tabs.profile')}>
              {firstName ? (
                <Text style={styles.avatarInitial}>{firstName.charAt(0).toUpperCase()}</Text>
              ) : (
                <Ionicons name="person" size={18} color={colors.sea} />
              )}
            </Pressable>
          </View>

          <View style={[styles.greeting, { alignItems: dir.alignStart }]}>
            <Text style={[styles.greetTitle, dir.text]}>
              {firstName
                ? `${t(greetingKey)} ${firstName}`
                : t(greetingKey).replace(/[,،]\s*$/, '')}
            </Text>
            <Text style={[styles.greetSub, dir.text]}>{t(greetingSubKey)}</Text>
          </View>

          <Pressable
            onPress={() => router.push('/(tabs)/browse')}
            accessibilityRole="search"
            accessibilityLabel={t('home.searchHint')}
            style={[styles.search, dir.row]}>
            <Icon name="search" size={16} color={colors.ink3} />
            <Text style={styles.searchText}>{t('home.searchHint')}</Text>
          </Pressable>
        </View>

        {showAllergyNudge && (
          <View style={styles.nudge}>
            <View style={{ flex: 1 }}>
              <Text style={styles.nudgeTitle}>{t('home.allergyNudgeTitle')}</Text>
              <Text style={styles.nudgeSub}>{t('home.allergyNudgeSub')}</Text>
            </View>
            <Pressable
              onPress={() => {
                tap();
                router.push('/settings/allergies');
              }}
              style={styles.nudgeCta}>
              <Text style={styles.nudgeCtaText}>{t('home.allergyNudgeCta')}</Text>
            </Pressable>
            <Pressable
              onPress={() => {
                tap();
                dismissAllergyNudge();
              }}
              hitSlop={12}
              style={styles.nudgeClose}>
              <Text style={styles.nudgeCloseText}>✕</Text>
            </Pressable>
          </View>
        )}

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.cuisineRow}>
          {CUISINES.map((c) => (
            <CuisinePill
              key={c.key}
              label={t(c.tKey)}
              emoji={c.emoji}
              active={selectedCuisine === c.key}
              onPress={() => setSelectedCuisine(c.key as Cuisine | 'all')}
            />
          ))}
        </ScrollView>

        {savedOrders.length > 0 && (
          <View style={{ paddingHorizontal: 20, marginTop: 14 }}>
            <View style={[styles.secHead, dir.row]}>
              <Text style={styles.secTitle}>{t('home.savedForYou')}</Text>
            </View>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 12, paddingTop: 10 }}>
              {savedOrders.map((s) => (
                <Pressable
                  key={s.id}
                  onPress={() => openSaved(s)}
                  onLongPress={() => removeSaved(s)}
                  accessibilityRole="button"
                  accessibilityLabel={s.name}
                  style={styles.savedCard}>
                  <Text style={styles.savedName} numberOfLines={1}>{s.name}</Text>
                  <Text style={styles.savedSub} numberOfLines={1}>{s.restaurantName}</Text>
                  <Text style={styles.savedMeta}>{t('orders.itemsCount', { n: s.items.length })}</Text>
                </Pressable>
              ))}
            </ScrollView>
          </View>
        )}

        {reorderRail.length > 0 && (
          <View style={{ paddingHorizontal: 20, marginTop: 14 }}>
            <View style={[styles.secHead, dir.row]}>
              <Text style={styles.secTitle}>{t('home.reorder')}</Text>
            </View>
            <FlatList
              horizontal
              data={reorderRail}
              keyExtractor={(r) => r.id}
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ gap: 10, paddingTop: 10, paddingRight: 20 }}
              renderItem={({ item }) => (
                <Pressable
                  onPress={() => {
                    tap();
                    track('reorder_tapped', { restaurantId: item.id });
                    router.push(`/restaurant/${item.id}` as never);
                  }}
                  style={styles.reorderChip}>
                  <Image source={{ uri: item.coverImage }} style={styles.reorderImg} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.reorderName} numberOfLines={1}>{item.name}</Text>
                    <Text style={styles.reorderSub} numberOfLines={1}>
                      ★ {item.rating} · {item.prepTimeLow}–{item.prepTimeHigh} {t('common.minShort')}
                    </Text>
                  </View>
                </Pressable>
              )}
            />
          </View>
        )}

        {favoriteRail.length > 0 && (
          <View style={{ paddingHorizontal: 20, marginTop: 14 }}>
            <View style={[styles.secHead, dir.row]}>
              <Text style={styles.secTitle}>{t('home.favorites')}</Text>
            </View>
            <FlatList
              horizontal
              data={favoriteRail}
              keyExtractor={(r) => r.id}
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ gap: 10, paddingTop: 10, paddingRight: 20 }}
              renderItem={({ item }) => (
                <Pressable
                  onPress={() => {
                    tap();
                    router.push(`/restaurant/${item.id}` as never);
                  }}
                  style={styles.reorderChip}>
                  <Image source={{ uri: item.coverImage }} style={styles.reorderImg} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.reorderName} numberOfLines={1}>♥ {item.name}</Text>
                    <Text style={styles.reorderSub} numberOfLines={1}>
                      ★ {item.rating} · {item.prepTimeLow}–{item.prepTimeHigh} {t('common.minShort')}
                    </Text>
                  </View>
                </Pressable>
              )}
            />
          </View>
        )}

        {offers.length > 0 && (
          <View style={{ paddingHorizontal: 20, marginTop: 14 }}>
            <View style={[styles.secHead, dir.row]}>
              <Text style={styles.secTitle}>{t('home.offers')}</Text>
            </View>
            <FlatList
              horizontal
              data={offers}
              keyExtractor={(r) => r.id}
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ gap: 10, paddingTop: 10, paddingRight: 20 }}
              renderItem={({ item }) => (
                <Pressable
                  onPress={() => {
                    tap();
                    router.push(`/restaurant/${item.id}` as never);
                  }}
                  accessibilityRole="button"
                  accessibilityLabel={`${item.name}: ${item.promo}`}
                  style={styles.offerChip}>
                  <Image source={{ uri: item.coverImage }} style={styles.reorderImg} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.offerPromo} numberOfLines={1}>🏷 {item.promo}</Text>
                    <Text style={styles.reorderName} numberOfLines={1}>{item.name}</Text>
                    <Text style={styles.reorderSub} numberOfLines={1}>
                      ★ {item.rating} · {item.prepTimeLow}–{item.prepTimeHigh} {t('common.minShort')}
                    </Text>
                  </View>
                </Pressable>
              )}
            />
          </View>
        )}

        {featured.length > 0 && (
          <View style={{ paddingHorizontal: 20, marginTop: 14 }}>
            <View style={[styles.secHead, dir.row]}>
              <Text style={styles.secTitle}>{t(featuredKey)}</Text>
              <Text style={styles.secMore}>{t('home.seeAll')} →</Text>
            </View>
            <FlatList
              horizontal
              data={featured}
              keyExtractor={(r) => r.id}
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ gap: 12, paddingRight: 20 }}
              renderItem={({ item }) => (
                <Pressable
                  onPress={() => {
                    tap();
                    router.push(`/restaurant/${item.id}` as never);
                  }}
                  style={styles.feat}>
                  <Image source={{ uri: item.coverImage }} style={styles.featImg} />
                  <View style={styles.featOverlay} />
                  <View style={styles.featMeta}>
                    <Text style={styles.featEyebrow}>
                      {item.touristSafe ? `★ ${t('home.featuredEyebrowTouristSafe')}` : `★ ${t('home.featuredEyebrowLocal')}`}
                    </Text>
                    <Text style={styles.featName}>{item.name}</Text>
                    <Text style={styles.featSub}>
                      {item.cuisineLabel} · {item.prepTimeLow}–{item.prepTimeHigh} {t('common.minShort')} · ★ {item.rating}
                    </Text>
                  </View>
                </Pressable>
              )}
            />
          </View>
        )}

        <View style={{ paddingHorizontal: 20, marginTop: 22 }}>
          <View style={[styles.secHead, dir.row]}>
            <Text style={styles.secTitle}>{t('home.nearby')}</Text>
            <Text style={styles.secMore}>{t('home.seeAll')} →</Text>
          </View>
          <View style={{ gap: 12, marginTop: 12 }}>
            {restaurants.map((r) => (
              <RestaurantCard key={r.id} restaurant={r} />
            ))}
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  top: {
    backgroundColor: colors.sand,
    paddingHorizontal: 20,
    paddingBottom: 22,
  },
  addrRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  addrLeft: { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 },
  addrIco: {
    width: 36,
    height: 36,
    borderRadius: 11,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.line,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addrLbl: {
    fontSize: 10,
    color: colors.ink2,
    fontWeight: font.weights.bold,
    letterSpacing: 0.7,
  },
  addrNameRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  addrName: { fontSize: font.sizes.xl, color: colors.ink, fontWeight: font.weights.semibold, flexShrink: 1 },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    overflow: 'hidden',
    backgroundColor: colors.seaSoft,
    borderWidth: 1,
    borderColor: colors.line,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarInitial: { fontSize: font.sizes.xl, fontWeight: font.weights.extrabold, color: colors.sea },
  greeting: { marginTop: 18 },
  greetTitle: {
    fontSize: 30,
    fontWeight: font.weights.extrabold,
    color: colors.ink,
    letterSpacing: -0.6,
    lineHeight: 34,
  },
  greetSub: { color: colors.ink2, fontSize: font.sizes.lg, marginTop: 6 },
  search: {
    marginTop: 18,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.lg,
    paddingHorizontal: 14,
    paddingVertical: 13,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    ...shadow.soft,
  },
  searchText: { flex: 1, color: colors.ink3, fontSize: font.sizes.lg },
  cuisineRow: { gap: 8, paddingHorizontal: 20, paddingTop: 14, paddingBottom: 6 },
  secHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end' },
  secTitle: { fontSize: font.sizes['4xl'], fontWeight: font.weights.extrabold, color: colors.ink, letterSpacing: -0.4 },
  secMore: { fontSize: font.sizes.md, color: colors.sea, fontWeight: font.weights.bold },
  // Brand sea-teal base so an unloaded/failed cover still reads as an intentional
  // branded tile (white label + overlay stay legible) rather than a black void.
  feat: { width: 280, height: 170, borderRadius: radius.xl, overflow: 'hidden', backgroundColor: colors.sea },
  featImg: { width: '100%', height: '100%' },
  featOverlay: {
    position: 'absolute',
    inset: 0 as unknown as number,
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.35)',
  },
  featMeta: { position: 'absolute', left: 14, right: 14, bottom: 12 },
  featEyebrow: {
    color: colors.white,
    fontSize: 10,
    fontWeight: font.weights.bold,
    letterSpacing: 0.6,
    opacity: 0.9,
  },
  featName: {
    color: colors.white,
    fontSize: font.sizes['5xl'],
    fontWeight: font.weights.extrabold,
    marginTop: 4,
    letterSpacing: -0.4,
  },
  featSub: { color: colors.white, fontSize: font.sizes.md, opacity: 0.9, marginTop: 4 },
  reorderChip: {
    width: 240,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: colors.white,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.line,
    padding: 8,
    ...shadow.soft,
  },
  reorderImg: { width: 52, height: 52, borderRadius: radius.md, backgroundColor: colors.bgSoft },
  reorderName: { fontSize: font.sizes.lg, color: colors.ink, fontWeight: font.weights.bold },
  reorderSub: { fontSize: font.sizes.sm, color: colors.ink2, marginTop: 2 },
  offerChip: {
    width: 260,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: colors.white,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.accent,
    padding: 8,
    ...shadow.soft,
  },
  offerPromo: {
    fontSize: font.sizes.sm,
    color: colors.accent,
    fontWeight: font.weights.extrabold,
    marginBottom: 2,
  },
  nudge: {
    marginHorizontal: 16,
    marginTop: 14,
    padding: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: colors.seaSoft,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.sea,
  },
  nudgeTitle: { fontSize: font.sizes.lg, color: colors.sea, fontWeight: font.weights.bold },
  nudgeSub: { fontSize: font.sizes.sm, color: colors.ink2, marginTop: 2 },
  nudgeCta: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: colors.sea,
    borderRadius: radius.pill,
  },
  nudgeCtaText: { color: colors.white, fontSize: font.sizes.md, fontWeight: font.weights.bold },
  nudgeClose: { padding: 4 },
  nudgeCloseText: { color: colors.ink3, fontSize: 16 },
  savedCard: {
    width: 168,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.lg,
    padding: 12,
    ...shadow.soft,
  },
  savedName: { fontSize: font.sizes.lg, fontWeight: font.weights.bold, color: colors.ink },
  savedSub: { fontSize: font.sizes.sm, color: colors.ink2, marginTop: 4 },
  savedMeta: { fontSize: font.sizes.sm, color: colors.ink3, marginTop: 6 },
});
