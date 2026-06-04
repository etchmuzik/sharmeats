import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  FlatList,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BackButton } from '../../src/components/BackButton';
import { FlagBadge } from '../../src/components/FlagBadge';
import { TouristSafeBadge } from '../../src/components/TouristSafeBadge';
import { PrimaryButton } from '../../src/components/PrimaryButton';
import { colors, font, radius, shadow } from '../../src/theme';
import { db } from '../../src/data';
import type { MenuItem, MenuSection, Restaurant } from '../../src/data/types';
import { formatEgp } from '../../src/lib/format';
import { useT } from '../../src/i18n';
import { useCart } from '../../src/store/cart';
import { tap } from '../../src/haptics';

export default function RestaurantDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const t = useT();
  const [restaurant, setRestaurant] = useState<Restaurant | null>(null);
  const [sections, setSections] = useState<MenuSection[]>([]);
  const [items, setItems] = useState<MenuItem[]>([]);
  const [activeSection, setActiveSection] = useState<string>('');

  const cartCount = useCart((s) => s.count());
  const cartSubtotal = useCart((s) => s.subtotal());
  const cartRestaurantId = useCart((s) => s.restaurantId);

  const scrollY = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!id) return;
    db.restaurants.get(id).then(setRestaurant);
    db.menus.forRestaurant(id).then((m) => {
      setSections(m.sections);
      setItems(m.items);
      setActiveSection(m.sections[0]?.id ?? '');
    });
  }, [id]);

  const itemsBySection = useMemo(() => {
    const map = new Map<string, MenuItem[]>();
    for (const s of sections) map.set(s.id, []);
    for (const i of items) map.get(i.sectionId)?.push(i);
    return map;
  }, [sections, items]);

  if (!restaurant) {
    return (
      <View style={styles.loading}>
        <StatusBar style="dark" />
        <Text style={{ color: colors.ink3 }}>{t('common.loading')}</Text>
      </View>
    );
  }

  const showCartBar = cartCount > 0 && cartRestaurantId === restaurant.id;

  return (
    <View style={{ flex: 1, backgroundColor: colors.white }}>
      <StatusBar style="light" />

      <Animated.ScrollView
        showsVerticalScrollIndicator={false}
        onScroll={Animated.event([{ nativeEvent: { contentOffset: { y: scrollY } } }], {
          useNativeDriver: true,
        })}
        scrollEventThrottle={16}
        contentContainerStyle={{ paddingBottom: showCartBar ? 120 : 40 + insets.bottom }}>
        <View style={styles.hero}>
          <Image source={{ uri: restaurant.coverImage }} style={styles.heroImg} />
          <View style={styles.heroFade} />
        </View>

        <View style={styles.info}>
          <Text style={styles.name}>{restaurant.name}</Text>
          <View style={styles.subRow}>
            <Text style={styles.sub}>{restaurant.cuisineLabel}</Text>
            {restaurant.touristSafe && <TouristSafeBadge />}
          </View>

          <View style={styles.stats}>
            <View style={styles.stat}>
              <Text style={styles.statV}>★ {restaurant.rating.toFixed(1)}</Text>
              <Text style={styles.statL}>{restaurant.ratingCount} ratings</Text>
            </View>
            <View style={[styles.stat, styles.statDivider]}>
              <Text style={styles.statV}>{restaurant.prepTimeLow}–{restaurant.prepTimeHigh} min</Text>
              <Text style={styles.statL}>{t('restaurant.toYourHotel')}</Text>
            </View>
            <View style={[styles.stat, styles.statDivider]}>
              <Text style={styles.statV}>{formatEgp(restaurant.deliveryFeeEgp)}</Text>
              <Text style={styles.statL}>{t('restaurant.delivery')}</Text>
            </View>
          </View>

          <Text style={styles.descr}>{restaurant.description}</Text>
        </View>

        <View style={styles.menuNav}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 18, paddingHorizontal: 20 }}>
            {sections.map((s) => (
              <Pressable
                key={s.id}
                onPress={() => {
                  tap();
                  setActiveSection(s.id);
                }}
                style={styles.navTabWrap}>
                <Text style={[styles.navTab, activeSection === s.id && styles.navTabActive]}>{s.name}</Text>
                {activeSection === s.id && <View style={styles.navUnderline} />}
              </Pressable>
            ))}
          </ScrollView>
        </View>

        <View style={{ paddingHorizontal: 20, paddingTop: 12 }}>
          {sections.map((sec) => (
            <View key={sec.id} style={{ marginBottom: 18 }}>
              <Text style={styles.sectionH}>{sec.name}</Text>
              {(itemsBySection.get(sec.id) ?? []).map((it) => (
                <Pressable
                  key={it.id}
                  onPress={() => router.push(`/item/${it.id}` as never)}
                  style={({ pressed }) => [styles.item, pressed && { opacity: 0.93 }]}>
                  <View style={{ flex: 1, paddingRight: 12 }}>
                    <Text style={styles.itemName}>{it.name}</Text>
                    <Text style={styles.itemDesc} numberOfLines={2}>
                      {it.description}
                    </Text>
                    <View style={styles.itemMeta}>
                      <Text style={styles.itemPrice}>{formatEgp(it.priceEgp)}</Text>
                      {it.flags.map((f) => (
                        <FlagBadge key={f} flag={f} />
                      ))}
                    </View>
                  </View>
                  <View style={styles.itemPh}>
                    <Image source={{ uri: it.image }} style={{ width: '100%', height: '100%' }} />
                    <View style={styles.addCircle}>
                      <Text style={styles.addPlus}>+</Text>
                    </View>
                  </View>
                </Pressable>
              ))}
            </View>
          ))}
        </View>
      </Animated.ScrollView>

      <View style={[styles.heroNav, { top: insets.top + 6 }]}>
        <BackButton tint="light" />
      </View>

      {showCartBar && (() => {
        const shortBy = Math.max(0, (restaurant?.minOrderEgp ?? 0) - cartSubtotal);
        const belowMin = shortBy > 0;
        return (
          <Pressable
            onPress={() => router.push('/(tabs)/cart')}
            style={[styles.cta, { bottom: 24 + insets.bottom }, belowMin && styles.ctaWarn]}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <View style={styles.ctaCount}>
                <Text style={styles.ctaCountText}>{cartCount}</Text>
              </View>
              <Text style={styles.ctaLabel}>
                {belowMin
                  ? t('checkout.minOrderShort', { amount: formatEgp(shortBy) })
                  : t('restaurant.viewCart')}
              </Text>
            </View>
            <Text style={styles.ctaPrice}>{formatEgp(cartSubtotal)}</Text>
          </Pressable>
        );
      })()}
    </View>
  );
}

const styles = StyleSheet.create({
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg },
  hero: { height: 240, backgroundColor: '#222', position: 'relative' },
  heroImg: { width: '100%', height: '100%' },
  heroFade: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    height: 120,
    backgroundColor: 'rgba(0,0,0,0.18)',
  },
  heroNav: { position: 'absolute', left: 14, zIndex: 10 },
  info: { padding: 20, paddingTop: 18 },
  name: { fontSize: 28, fontWeight: font.weights.extrabold, letterSpacing: -0.5, color: colors.ink },
  subRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 6 },
  sub: { color: colors.ink2, fontSize: font.sizes.lg },
  stats: {
    marginTop: 14,
    backgroundColor: colors.sand,
    borderRadius: radius.lg,
    paddingVertical: 12,
    paddingHorizontal: 14,
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  stat: { flex: 1, alignItems: 'center' },
  statDivider: { borderLeftWidth: 1, borderLeftColor: 'rgba(0,0,0,0.06)' },
  statV: { fontSize: font.sizes['2xl'], fontWeight: font.weights.extrabold, color: colors.ink },
  statL: { fontSize: 10.5, color: colors.ink2, marginTop: 2, textTransform: 'uppercase', fontWeight: font.weights.bold, letterSpacing: 0.5 },
  descr: { fontSize: font.sizes.lg, color: colors.ink2, lineHeight: 20, marginTop: 14 },
  menuNav: {
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: colors.line,
    paddingVertical: 12,
    backgroundColor: colors.white,
  },
  navTabWrap: { paddingBottom: 6 },
  navTab: { fontSize: font.sizes.lg, fontWeight: font.weights.bold, color: colors.ink3 },
  navTabActive: { color: colors.ink },
  navUnderline: { height: 2, backgroundColor: colors.accent, marginTop: 6, borderRadius: 1 },
  sectionH: { fontSize: font.sizes['3xl'], fontWeight: font.weights.extrabold, color: colors.ink, marginBottom: 8, marginTop: 6, letterSpacing: -0.3 },
  item: {
    flexDirection: 'row',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  itemName: { fontSize: font.sizes['2xl'], fontWeight: font.weights.bold, color: colors.ink },
  itemDesc: { fontSize: font.sizes.md, color: colors.ink2, marginTop: 4, lineHeight: 18 },
  itemMeta: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8, flexWrap: 'wrap' },
  itemPrice: { fontSize: font.sizes.xl, fontWeight: font.weights.bold, color: colors.ink },
  itemPh: { width: 84, height: 84, borderRadius: radius.md, overflow: 'hidden', backgroundColor: colors.bgSoft, position: 'relative' },
  addCircle: {
    position: 'absolute',
    bottom: 6,
    right: 6,
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.line,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadow.soft,
  },
  addPlus: { fontSize: 18, color: colors.ink, lineHeight: 20 },
  cta: {
    position: 'absolute',
    left: 16,
    right: 16,
    backgroundColor: colors.ink,
    borderRadius: radius.xxl,
    paddingHorizontal: 18,
    paddingVertical: 14,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    ...shadow.card,
  },
  ctaWarn: { backgroundColor: colors.amber },
  ctaCount: {
    width: 26,
    height: 26,
    borderRadius: 8,
    backgroundColor: 'rgba(255,255,255,0.16)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  ctaCountText: { color: colors.white, fontWeight: font.weights.bold, fontSize: font.sizes.base },
  ctaLabel: { color: colors.white, fontWeight: font.weights.bold, fontSize: font.sizes.xl },
  ctaPrice: { color: colors.white, fontWeight: font.weights.extrabold, fontSize: font.sizes['2xl'] },
});
