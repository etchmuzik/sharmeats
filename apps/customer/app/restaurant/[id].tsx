import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  FlatList,
  Image,
  Linking,
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
import type { MenuItem, MenuSection, Restaurant, Review } from '../../src/data/types';
import { formatEgp } from '../../src/lib/format';
import { useT } from '../../src/i18n';
import { useCart } from '../../src/store/cart';
import { tap, selection } from '../../src/haptics';
import { useFavorite } from '../../src/lib/favorites';
import { track } from '../../src/lib/analytics';

export default function RestaurantDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const t = useT();
  const [restaurant, setRestaurant] = useState<Restaurant | null>(null);
  const [sections, setSections] = useState<MenuSection[]>([]);
  const [items, setItems] = useState<MenuItem[]>([]);
  const [activeSection, setActiveSection] = useState<string>('');
  const [reviews, setReviews] = useState<Review[]>([]);
  const [loadError, setLoadError] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const { isFav, toggle: toggleFav } = useFavorite(id ?? '');

  const cartCount = useCart((s) => s.count());
  const cartSubtotal = useCart((s) => s.subtotal());
  const cartRestaurantId = useCart((s) => s.restaurantId);

  const scrollY = useRef(new Animated.Value(0)).current;
  // Scroll-to-section: the sticky tabs jump the list to a section's measured Y.
  const scrollRef = useRef<ScrollView>(null);
  const sectionY = useRef<Record<string, number>>({});

  const goToSection = (sectionId: string) => {
    tap();
    setActiveSection(sectionId);
    const y = sectionY.current[sectionId];
    if (y != null) scrollRef.current?.scrollTo({ y: Math.max(0, y - 8), animated: true });
  };

  useEffect(() => {
    if (!id) return;
    track('restaurant_viewed', { restaurantId: id });
    setLoadError(false);
    // The two load-bearing calls MUST .catch: on flaky hotel wifi a rejection
    // otherwise leaves `restaurant` null forever and freezes the screen on
    // "Loading…" with no way out. On failure we show a retry view instead.
    db.restaurants
      .get(id)
      .then(setRestaurant)
      .catch(() => setLoadError(true));
    db.menus
      .forRestaurant(id)
      .then((m) => {
        setSections(m.sections);
        setItems(m.items);
        setActiveSection(m.sections[0]?.id ?? '');
      })
      .catch(() => setLoadError(true));
    db.restaurants
      .reviews(id, 10)
      .then(setReviews)
      .catch(() => setReviews([]));
  }, [id, reloadKey]);

  const itemsBySection = useMemo(() => {
    const map = new Map<string, MenuItem[]>();
    for (const s of sections) map.set(s.id, []);
    for (const i of items) map.get(i.sectionId)?.push(i);
    return map;
  }, [sections, items]);

  if (loadError && !restaurant) {
    return (
      <View style={styles.loading}>
        <StatusBar style="dark" />
        <View style={styles.loadNav}>
          <BackButton />
        </View>
        <Text style={styles.loadErrText}>{t('common.error')}</Text>
        <Pressable
          onPress={() => {
            tap();
            setLoadError(false);
            setReloadKey((k) => k + 1);
          }}
          accessibilityRole="button"
          accessibilityLabel={t('common.retry')}
          style={styles.retryBtn}>
          <Text style={styles.retryText}>{t('common.retry')}</Text>
        </Pressable>
      </View>
    );
  }

  if (!restaurant) {
    return (
      <View style={styles.loading}>
        <StatusBar style="dark" />
        <View style={styles.loadNav}>
          <BackButton />
        </View>
        <Text style={{ color: colors.ink3 }}>{t('common.loading')}</Text>
      </View>
    );
  }

  const showCartBar = cartCount > 0 && cartRestaurantId === restaurant.id;

  return (
    <View style={{ flex: 1, backgroundColor: colors.white }}>
      <StatusBar style="light" />

      <Animated.ScrollView
        ref={scrollRef as never}
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

          {restaurant.promo && (
            <View style={styles.promoBanner}>
              <Text style={styles.promoText} numberOfLines={2}>🏷 {restaurant.promo}</Text>
            </View>
          )}

          <Text style={styles.descr}>{restaurant.description}</Text>

          {(restaurant.address || restaurant.phone) && (
            <View style={styles.contact}>
              {restaurant.address && (
                <Text style={styles.contactAddr} numberOfLines={2}>
                  📍 {restaurant.address}
                </Text>
              )}
              <View style={styles.contactActions}>
                {restaurant.phone && (
                  <Pressable
                    onPress={() => {
                      tap();
                      Linking.openURL(`tel:${restaurant.phone}`).catch(() => {});
                    }}
                    accessibilityRole="button"
                    accessibilityLabel={t('restaurant.callRestaurant')}
                    style={styles.contactBtn}>
                    <Text style={styles.contactBtnText}>📞 {t('restaurant.callRestaurant')}</Text>
                  </Pressable>
                )}
                {restaurant.address && (
                  <Pressable
                    onPress={() => {
                      tap();
                      const q = encodeURIComponent(`${restaurant.name} ${restaurant.address ?? ''}`.trim());
                      Linking.openURL(`https://maps.google.com/?q=${q}`).catch(() => {});
                    }}
                    accessibilityRole="button"
                    accessibilityLabel={t('restaurant.viewOnMap')}
                    style={styles.contactBtn}>
                    <Text style={styles.contactBtnText}>🗺 {t('restaurant.viewOnMap')}</Text>
                  </Pressable>
                )}
              </View>
            </View>
          )}

          {reviews.length > 0 && (
            <View style={{ marginTop: 16 }}>
              <Text style={styles.reviewsTitle}>{t('restaurant.reviews')}</Text>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={{ gap: 10, paddingTop: 10 }}>
                {reviews.map((rv, i) => (
                  <View key={`${rv.reviewer}-${rv.reviewedAt}-${i}`} style={styles.reviewCard}>
                    <View style={styles.reviewHead}>
                      <Text style={styles.reviewStars}>
                        {'★'.repeat(Math.max(1, Math.min(5, rv.ratingFood)))}
                      </Text>
                      <Text style={styles.reviewName} numberOfLines={1}>
                        {rv.reviewer}
                      </Text>
                    </View>
                    {rv.comment ? (
                      <Text style={styles.reviewBody} numberOfLines={3}>
                        {rv.comment}
                      </Text>
                    ) : (
                      <Text style={[styles.reviewBody, { color: colors.ink3 }]}>
                        ★ {rv.ratingFood}/5
                      </Text>
                    )}
                  </View>
                ))}
              </ScrollView>
            </View>
          )}
        </View>

        <View style={styles.menuNav}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 18, paddingHorizontal: 20 }}>
            {sections.map((s) => (
              <Pressable
                key={s.id}
                onPress={() => goToSection(s.id)}
                accessibilityRole="tab"
                accessibilityState={{ selected: activeSection === s.id }}
                accessibilityLabel={s.name}
                style={styles.navTabWrap}>
                <Text style={[styles.navTab, activeSection === s.id && styles.navTabActive]}>{s.name}</Text>
                {activeSection === s.id && <View style={styles.navUnderline} />}
              </Pressable>
            ))}
          </ScrollView>
        </View>

        <View
          style={{ paddingHorizontal: 20, paddingTop: 12 }}
          onLayout={(e) => {
            sectionY.current.__container = e.nativeEvent.layout.y;
          }}>
          {items.length === 0 && (
            <View style={styles.menuEmpty}>
              <Text style={styles.menuEmptyText}>{t('menu.empty')}</Text>
            </View>
          )}
          {sections.map((sec) => (
            <View
              key={sec.id}
              onLayout={(e) => {
                // Section Y is relative to its container; add the container's
                // offset to get the absolute scroll position.
                const containerTop = sectionY.current.__container ?? 0;
                sectionY.current[sec.id] = containerTop + e.nativeEvent.layout.y;
              }}
              style={{ marginBottom: 18 }}>
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
      <Pressable
        onPress={() => {
          selection();
          toggleFav();
        }}
        accessibilityRole="button"
        accessibilityState={{ selected: isFav }}
        accessibilityLabel={isFav ? t('fav.remove') : t('fav.add')}
        style={[styles.heroFav, { top: insets.top + 6 }]}>
        <Text style={[styles.heroFavIcon, isFav && { color: colors.accent }]}>
          {isFav ? '♥' : '♡'}
        </Text>
      </Pressable>

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
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg, gap: 16, paddingHorizontal: 32 },
  loadNav: { position: 'absolute', top: 56, left: 14 },
  loadErrText: { color: colors.ink2, fontSize: font.sizes.lg, textAlign: 'center', lineHeight: 24 },
  retryBtn: {
    paddingHorizontal: 22,
    paddingVertical: 12,
    borderRadius: radius.pill,
    backgroundColor: colors.ink,
  },
  retryText: { color: colors.white, fontSize: font.sizes.lg, fontWeight: font.weights.bold },
  // Branded teal base so an unloaded/failed cover reads as an intentional tile
  // (the white BackButton + fade stay legible) rather than a dark void.
  hero: { height: 240, backgroundColor: colors.sea, position: 'relative' },
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
  heroFav: {
    position: 'absolute',
    right: 14,
    zIndex: 10,
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: 'rgba(255,255,255,0.92)',
    alignItems: 'center',
    justifyContent: 'center',
    ...shadow.soft,
  },
  heroFavIcon: { fontSize: 20, color: colors.ink2, lineHeight: 22 },
  reviewsTitle: {
    fontSize: font.sizes.sm,
    color: colors.ink2,
    fontWeight: font.weights.bold,
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  reviewCard: {
    width: 230,
    padding: 12,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.bgSoft,
  },
  reviewHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  reviewStars: { color: colors.star, fontSize: font.sizes.md, fontWeight: font.weights.bold },
  reviewName: { color: colors.ink2, fontSize: font.sizes.sm, fontWeight: font.weights.semibold, flexShrink: 1 },
  reviewBody: { marginTop: 6, color: colors.ink, fontSize: font.sizes.md, lineHeight: 18 },
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
  contact: { marginTop: 14, gap: 10 },
  contactAddr: { fontSize: font.sizes.md, color: colors.ink2, lineHeight: 19 },
  contactActions: { flexDirection: 'row', gap: 10 },
  contactBtn: {
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: radius.xxl,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.bgSoft,
  },
  contactBtnText: { fontSize: font.sizes.md, fontWeight: font.weights.bold, color: colors.ink },
  promoBanner: {
    marginTop: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: radius.lg,
    backgroundColor: '#fff4ee',
    borderWidth: 1,
    borderColor: colors.accent,
  },
  promoText: { color: colors.accent, fontSize: font.sizes.lg, fontWeight: font.weights.bold },
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
  menuEmpty: { paddingVertical: 48, alignItems: 'center', justifyContent: 'center' },
  menuEmptyText: { fontSize: font.sizes.lg, color: colors.ink3, textAlign: 'center', lineHeight: 24 },
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
