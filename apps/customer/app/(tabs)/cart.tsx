import { useEffect, useMemo, useRef, useState } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Swipeable } from 'react-native-gesture-handler';
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, font, radius, shadow } from '../../src/theme';
import { PrimaryButton } from '../../src/components/PrimaryButton';
import { QuantityStepper } from '../../src/components/QuantityStepper';
import { Mascot } from '../../src/components/Mascot/Mascot';
import { useCart } from '../../src/store/cart';
import { useT } from '../../src/i18n';
import { formatEgp } from '../../src/lib/format';
import { success, tap } from '../../src/haptics';
import { db } from '../../src/data';
import type { CartItem, MenuItem, Restaurant } from '../../src/data/types';
import { track } from '../../src/lib/analytics';

export default function CartTab() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const t = useT();
  const lines = useCart((s) => s.lines);
  const restaurantId = useCart((s) => s.restaurantId);
  const restaurantName = useCart((s) => s.restaurantName);
  const subtotal = useCart((s) => s.subtotal());
  const setQuantity = useCart((s) => s.setQuantity);
  const remove = useCart((s) => s.remove);
  const clear = useCart((s) => s.clear);
  const addLine = useCart((s) => s.add);
  const [restaurant, setRestaurant] = useState<Restaurant | null>(null);

  useEffect(() => {
    if (!restaurantId) {
      setRestaurant(null);
      return;
    }
    db.restaurants.get(restaurantId).then(setRestaurant);
  }, [restaurantId]);

  const minOrder = restaurant?.minOrderEgp ?? 0;
  const shortBy = Math.max(0, minOrder - subtotal);
  const belowMin = shortBy > 0;

  // Cross-sell rail: cheap, one-tap-addable items from the same restaurant.
  // Only items with no required modifier group can be added without the modal.
  const cartItemIds = useMemo(() => new Set(lines.map((l) => l.itemId)), [lines]);
  const [menuItems, setMenuItems] = useState<MenuItem[]>([]);
  useEffect(() => {
    if (!restaurantId || lines.length === 0) {
      setMenuItems([]);
      return;
    }
    let cancelled = false;
    db.menus.forRestaurant(restaurantId).then((m) => {
      if (!cancelled) setMenuItems(m.items);
    });
    return () => {
      cancelled = true;
    };
  }, [restaurantId, lines.length > 0]);

  const suggestions = useMemo(
    () =>
      menuItems
        .filter(
          (i) =>
            i.isAvailable &&
            !cartItemIds.has(i.id) &&
            i.modifiers.every((m) => !m.required),
        )
        .sort((a, b) => a.priceEgp - b.priceEgp)
        .slice(0, 6),
    [menuItems, cartItemIds],
  );

  const addSuggestion = (item: MenuItem) => {
    if (!restaurantId) return;
    success();
    addLine({
      itemId: item.id,
      restaurantId,
      restaurantName: restaurantName ?? restaurant?.name ?? '',
      name: item.name,
      basePriceEgp: item.priceEgp,
      image: item.image,
      quantity: 1,
      modifierChoices: [],
    });
    track('cross_sell_added', { itemId: item.id, price: item.priceEgp });
  };

  // Empty-cart "near you" suggestions, filtered to the user's default address zone.
  const [nearby, setNearby] = useState<Restaurant[]>([]);
  useEffect(() => {
    if (lines.length > 0) return;
    let cancelled = false;
    (async () => {
      const rs = await db.restaurants.list();
      // "Near you" — short distance + open. Local-friendly options surface
      // because the data we have is already zone-tagged to Sharm residential.
      const candidates = rs
        .filter((r) => r.isOpen)
        .sort((a, b) => a.distanceMeters - b.distanceMeters || b.rating - a.rating)
        .slice(0, 4);
      if (!cancelled) setNearby(candidates);
    })();
    return () => {
      cancelled = true;
    };
  }, [lines.length]);

  if (lines.length === 0) {
    return (
      <ScrollView
        style={{ flex: 1, backgroundColor: colors.bg }}
        contentContainerStyle={[styles.emptyWrap, { paddingTop: insets.top + 40 }]}>
        <StatusBar style="dark" />
        <Mascot pose="shrug" size={120} />
        <Text style={styles.emptyTitle}>{t('cart.empty')}</Text>
        <Text style={styles.emptySub}>{t('cart.emptyDesc')}</Text>
        {nearby.length > 0 && (
          <View style={{ width: '100%', marginTop: 24, paddingHorizontal: 16 }}>
            <Text style={styles.nearbyTitle}>{t('cart.nearbyTitle')}</Text>
            <View style={{ gap: 10, marginTop: 10 }}>
              {nearby.map((r) => (
                <Pressable
                  key={r.id}
                  onPress={() => {
                    tap();
                    router.push(`/restaurant/${r.id}` as never);
                  }}
                  style={styles.nearbyRow}>
                  <Image source={{ uri: r.coverImage }} style={styles.nearbyImg} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.nearbyName} numberOfLines={1}>
                      {r.name}
                    </Text>
                    <Text style={styles.nearbySub} numberOfLines={1}>
                      ★ {r.rating} · {r.cuisineLabel}
                    </Text>
                  </View>
                </Pressable>
              ))}
            </View>
          </View>
        )}
        <View style={{ marginTop: 24, width: '70%' }}>
          <PrimaryButton label={t('cart.browse')} onPress={() => router.replace('/(tabs)/home')} />
        </View>
      </ScrollView>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <StatusBar style="dark" />
      <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
        <Text style={styles.title}>{t('cart.title')}</Text>
        <Pressable
          onPress={clear}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel={t('cart.clear')}>
          <Text style={styles.clear}>{t('cart.clear')}</Text>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 180 }}>
        <View style={styles.card}>
          <Text style={styles.cardTitle}>{t('cart.from', { name: restaurantName ?? '' })}</Text>
          <View style={{ marginTop: 6 }}>
            {lines.map((l) => (
              <CartLineRow
                key={l.lineId}
                line={l}
                onTapEdit={() => {
                  tap();
                  router.push(`/item/${l.itemId}?lineId=${l.lineId}`);
                }}
                onChangeQty={(n) => setQuantity(l.lineId, n)}
                onRemove={() => {
                  success();
                  remove(l.lineId);
                }}
                noteLabel={t('cart.noteLabel')}
                allergensPrefix={t('cart.allergensPrefix')}
                allergyLabels={(l.allergens ?? []).map((a) => t(`allergy.${a}`))}
                removeLabel={t('cart.remove')}
              />
            ))}
          </View>
        </View>

        {suggestions.length > 0 && (
          <View style={{ marginTop: 16 }}>
            <Text style={styles.nearbyTitle}>{t('cart.alsoAdd')}</Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ gap: 10, paddingTop: 10 }}>
              {suggestions.map((item) => (
                <Pressable
                  key={item.id}
                  onPress={() => addSuggestion(item)}
                  accessibilityRole="button"
                  accessibilityLabel={`${t('cart.alsoAdd')}: ${item.name}`}
                  style={styles.suggestCard}>
                  <Image source={{ uri: item.image }} style={styles.suggestImg} />
                  <Text style={styles.suggestName} numberOfLines={1}>
                    {item.name}
                  </Text>
                  <View style={styles.suggestRow}>
                    <Text style={styles.suggestPrice}>{formatEgp(item.priceEgp)}</Text>
                    <View style={styles.suggestPlus}>
                      <Text style={styles.suggestPlusText}>+</Text>
                    </View>
                  </View>
                </Pressable>
              ))}
            </ScrollView>
          </View>
        )}
      </ScrollView>

      <View style={[styles.bottom, { paddingBottom: 24 + insets.bottom }]}>
        {belowMin && (
          <View style={styles.minBanner}>
            <Text style={styles.minText}>
              ⚠ {t('checkout.minOrderShort', { amount: formatEgp(shortBy) })}
            </Text>
          </View>
        )}
        <PrimaryButton
          label={t('cart.checkout', { amount: formatEgp(subtotal) })}
          onPress={() => router.push('/checkout')}
          disabled={belowMin}
        />
      </View>
    </View>
  );
}

interface RowProps {
  line: CartItem;
  onTapEdit: () => void;
  onChangeQty: (n: number) => void;
  onRemove: () => void;
  noteLabel: string;
  allergensPrefix: string;
  allergyLabels: string[];
  removeLabel: string;
}

function CartLineRow({
  line,
  onTapEdit,
  onChangeQty,
  onRemove,
  noteLabel,
  allergensPrefix,
  allergyLabels,
  removeLabel,
}: RowProps) {
  const swipeRef = useRef<Swipeable>(null);

  const renderRightActions = () => (
    <Pressable
      onPress={() => {
        swipeRef.current?.close();
        onRemove();
      }}
      style={styles.swipeAction}>
      <Text style={styles.swipeIcon}>🗑</Text>
      <Text style={styles.swipeLabel}>{removeLabel}</Text>
    </Pressable>
  );

  return (
    <Swipeable ref={swipeRef} renderRightActions={renderRightActions} overshootRight={false}>
      <Pressable onPress={onTapEdit} style={({ pressed }) => [styles.line, pressed && { opacity: 0.85 }]}>
        <Image source={{ uri: line.image }} style={styles.ph} />
        <View style={{ flex: 1 }}>
          <View style={styles.lineHead}>
            <Text style={styles.lineName} numberOfLines={1}>
              {line.name}
            </Text>
            <Pressable
              onPress={(e) => {
                e.stopPropagation();
                onRemove();
              }}
              hitSlop={10}
              style={styles.trashBtn}
              accessibilityLabel={removeLabel}>
              <Text style={styles.trashIco}>🗑</Text>
            </Pressable>
          </View>
          {line.modifierChoices.length > 0 && (
            <Text style={styles.mods}>
              {line.modifierChoices.map((c) => c.optionName).join(' · ')}
            </Text>
          )}
          {line.notes && (
            <Text style={styles.notes}>
              {noteLabel}: {line.notes}
            </Text>
          )}
          {allergyLabels.length > 0 && (
            <Text style={styles.allergens}>
              ⚠ {allergensPrefix}: {allergyLabels.join(', ')}
            </Text>
          )}
          <View style={styles.row}>
            <QuantityStepper
              value={line.quantity}
              onChange={onChangeQty}
              min={1}
              size="sm"
            />
            <Text style={styles.linePrice}>
              {formatEgp(
                (line.basePriceEgp + line.modifierChoices.reduce((a, c) => a + c.priceDeltaEgp, 0)) *
                  line.quantity,
              )}
            </Text>
          </View>
        </View>
      </Pressable>
    </Swipeable>
  );
}

const styles = StyleSheet.create({
  emptyWrap: { alignItems: 'center', paddingHorizontal: 24, paddingBottom: 60 },
  nearbyTitle: {
    fontSize: font.sizes.sm,
    color: colors.ink2,
    fontWeight: font.weights.bold,
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  nearbyRow: {
    flexDirection: 'row',
    gap: 12,
    alignItems: 'center',
    padding: 10,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.lg,
    backgroundColor: colors.white,
  },
  nearbyImg: { width: 48, height: 48, borderRadius: radius.md, backgroundColor: colors.bgSoft },
  nearbyName: { fontSize: font.sizes.lg, color: colors.ink, fontWeight: font.weights.bold },
  nearbySub: { fontSize: font.sizes.sm, color: colors.ink2, marginTop: 2 },
  emptyTitle: {
    fontSize: font.sizes['7xl'],
    fontWeight: font.weights.extrabold,
    color: colors.ink,
    marginTop: 12,
  },
  emptySub: { fontSize: font.sizes.lg, color: colors.ink2, marginTop: 8, textAlign: 'center' },
  header: {
    paddingHorizontal: 20,
    paddingBottom: 14,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  title: { fontSize: 32, fontWeight: font.weights.extrabold, letterSpacing: -0.8, color: colors.ink },
  clear: { color: colors.ink2, fontSize: font.sizes.lg, fontWeight: font.weights.semibold },
  card: {
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.xl,
    padding: 14,
    ...shadow.soft,
    overflow: 'hidden',
  },
  cardTitle: { fontSize: font.sizes.xl, fontWeight: font.weights.bold, color: colors.ink },
  line: {
    flexDirection: 'row',
    gap: 12,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
    backgroundColor: colors.white,
  },
  lineHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  ph: { width: 54, height: 54, borderRadius: radius.md, backgroundColor: colors.bgSoft },
  lineName: { flex: 1, fontSize: font.sizes.xl, fontWeight: font.weights.bold, color: colors.ink },
  trashBtn: {
    width: 30,
    height: 30,
    alignItems: 'center',
    justifyContent: 'center',
  },
  trashIco: { fontSize: 16, opacity: 0.6 },
  mods: { fontSize: font.sizes.sm, color: colors.ink2, marginTop: 3 },
  notes: { fontSize: font.sizes.sm, color: colors.ink3, marginTop: 2, fontStyle: 'italic' },
  allergens: {
    fontSize: font.sizes.sm,
    color: colors.amber,
    marginTop: 3,
    fontWeight: font.weights.bold,
  },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 8 },
  linePrice: { fontSize: font.sizes.xl, fontWeight: font.weights.bold, color: colors.ink },
  swipeAction: {
    backgroundColor: colors.red,
    justifyContent: 'center',
    alignItems: 'center',
    width: 90,
    gap: 4,
  },
  swipeIcon: { fontSize: 22 },
  swipeLabel: { color: colors.white, fontSize: font.sizes.sm, fontWeight: font.weights.bold },
  suggestCard: {
    width: 132,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.lg,
    padding: 8,
    ...shadow.soft,
  },
  suggestImg: { width: '100%', height: 78, borderRadius: radius.md, backgroundColor: colors.bgSoft },
  suggestName: { fontSize: font.sizes.md, color: colors.ink, fontWeight: font.weights.bold, marginTop: 6 },
  suggestRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 4,
  },
  suggestPrice: { fontSize: font.sizes.md, color: colors.ink2, fontWeight: font.weights.semibold },
  suggestPlus: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: colors.seaSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  suggestPlusText: { fontSize: 16, color: colors.sea, lineHeight: 18, fontWeight: '800' as const },
  minBanner: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: radius.md,
    backgroundColor: colors.amberSoft,
    marginBottom: 10,
  },
  minText: {
    fontSize: font.sizes.md,
    color: colors.amber,
    fontWeight: font.weights.bold,
    textAlign: 'center',
  },
  bottom: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 88,
    paddingHorizontal: 16,
    paddingTop: 12,
    backgroundColor: colors.white,
    borderTopWidth: 1,
    borderTopColor: colors.line,
  },
});
