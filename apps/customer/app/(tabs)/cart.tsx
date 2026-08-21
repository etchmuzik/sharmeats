import { useEffect, useMemo, useRef, useState } from 'react';
import { Image, Pressable, ScrollView, Text, View } from 'react-native';
import { Swipeable } from 'react-native-gesture-handler';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { font, radius, shadow } from '../../src/theme';
import { ThemedStatusBar, makeStyles, useThemeColors } from '../../src/themeProvider';
import { PrimaryButton } from '../../src/components/PrimaryButton';
import { QuantityStepper } from '../../src/components/QuantityStepper';
import { Icon } from '../../src/components/Icon';
import { useCart } from '../../src/store/cart';
import { useT } from '../../src/i18n';
import { formatEgp, formatNumber } from '../../src/lib/format';
import { isCrossSellEligible } from '../../src/lib/crossSell';
import { CartConflictSheet } from '../../src/components/CartConflictSheet';
import { decideRestore } from '../../src/lib/cartSync';
import { restoreServerCart, restoreFailureReason } from '../../src/lib/cartRestore';
import { isBackendLive } from '../../src/data';
import type { ServerCart } from '../../src/data/types';
import { success, tap } from '../../src/haptics';
import { db } from '../../src/data';
import type { CartItem, MenuItem, Restaurant } from '../../src/data/types';
import { track } from '../../src/lib/analytics';
import { useSession, type Locale } from '../../src/store/session';
import { useDirection } from '../../src/lib/direction';

export default function CartTab() {
  const colors = useThemeColors();
  const styles = useStyles();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const t = useT();
  const locale = useSession((s) => s.locale);
  const dir = useDirection();
  const lines = useCart((s) => s.lines);
  const restaurantId = useCart((s) => s.restaurantId);
  const restaurantName = useCart((s) => s.restaurantName);
  const subtotal = useCart((s) => s.subtotal());
  const setQuantity = useCart((s) => s.setQuantity);
  const remove = useCart((s) => s.remove);
  // clearEverywhere, not clear: an explicit empty is one of the two cases that
  // should retire the SERVER cart too (the other is a confirmed placement).
  // Plain clear() is local-only and belongs to sign-out — see the store.
  const clearEverywhere = useCart((s) => s.clearEverywhere);
  const addLine = useCart((s) => s.add);
  const [restaurant, setRestaurant] = useState<Restaurant | null>(null);

  useEffect(() => {
    if (!restaurantId) {
      setRestaurant(null);
      return;
    }
    db.restaurants.get(restaurantId).then(setRestaurant);
  }, [restaurantId]);

  // ---- Cross-device cart reconciliation (Package 02 Slice D) --------------
  // On focus, compare this device's basket against the stored one. A difference
  // is ALWAYS shown to the customer (never auto-resolved) — see decideRestore.
  const adoptPrepared = useCart((s) => s.adoptPrepared);
  const setServerVersion = useCart((s) => s.setServerVersion);
  const syncToServer = useCart((s) => s.syncToServer);
  const [conflict, setConflict] = useState<{
    cart: ServerCart;
    sameRestaurant: boolean;
    stale: boolean;
    name: string;
  } | null>(null);
  const [resolving, setResolving] = useState(false);
  // Check once per mount. A cart edited locally then re-checked would fight the
  // debounced sync, and the conflict is a startup question, not a per-keystroke one.
  const conflictChecked = useRef(false);

  useEffect(() => {
    if (!isBackendLive || conflictChecked.current) return;
    conflictChecked.current = true;
    let cancelled = false;
    (async () => {
      try {
        const server = await db.cart.get();
        if (cancelled) return;
        const decision = decideRestore(
          { restaurantId, lines },
          server,
        );
        if (decision.kind === 'in_sync') {
          setServerVersion(decision.cart.version);
          return;
        }
        if (decision.kind === 'adopt_server') {
          // Local basket is empty, so there is nothing to lose: bring the saved
          // cart back without asking. It still goes through prepare_cart.
          try {
            const restored = await restoreServerCart(decision.cart);
            if (cancelled) return;
            adoptPrepared({ ...restored, version: decision.cart.version });
            track('cart_restored', {
              source: 'server_cart',
              lineCount: restored.lines.length,
              droppedCount: restored.droppedCount,
              stale: decision.stale,
            });
          } catch (e) {
            // A failed restore must leave the (empty) local cart alone.
            track('cart_restore_failed', { reason: restoreFailureReason(e) });
          }
          return;
        }
        if (decision.kind === 'ask') {
          const name =
            (await db.restaurants.get(decision.cart.restaurantId ?? '').catch(() => null))?.name ??
            t('cart.title');
          if (cancelled) return;
          setConflict({
            cart: decision.cart,
            sameRestaurant: decision.sameRestaurant,
            stale: decision.stale,
            name,
          });
          track('cart_conflict_shown', {
            sameRestaurant: decision.sameRestaurant,
            stale: decision.stale,
          });
        }
      } catch {
        // Offline, or the RPC is not deployed. The local basket is authoritative
        // and untouched; the next launch tries again.
      }
    })();
    return () => {
      cancelled = true;
    };
    // Deliberately mount-only: `lines`/`restaurantId` are read once as the
    // starting state. Re-running on every edit would re-ask mid-shopping.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const keepLocalCart = () => {
    setConflict(null);
    track('cart_conflict_resolved', { choice: 'local' });
    // Force this device's basket to win by writing on top of the server's
    // current version. Re-read it first: the local serverVersion is -1 or stale
    // by definition here, so reusing it would just conflict again.
    void (async () => {
      try {
        const current = await db.cart.get();
        setServerVersion(current?.version ?? 0);
        syncToServer();
      } catch {
        // Next mutation retries.
      }
    })();
  };

  const useSavedCart = () => {
    if (!conflict) return;
    setResolving(true);
    void (async () => {
      try {
        const restored = await restoreServerCart(conflict.cart);
        adoptPrepared({ ...restored, version: conflict.cart.version });
        track('cart_conflict_resolved', { choice: 'saved' });
        track('cart_restored', {
          source: 'conflict_sheet',
          lineCount: restored.lines.length,
          droppedCount: restored.droppedCount,
          stale: conflict.stale,
        });
        setConflict(null);
      } catch (e) {
        track('cart_restore_failed', { reason: restoreFailureReason(e) });
        // Keep the sheet open on failure rather than silently falling back to a
        // basket the customer did not choose.
        setResolving(false);
        return;
      }
      setResolving(false);
    })();
  };

  const minOrder = restaurant?.minOrderEgp ?? 0;
  const shortBy = Math.max(0, minOrder - subtotal);
  const belowMin = shortBy > 0;

  // Cross-sell rail: cheap, one-tap-addable items from the same restaurant.
  // Eligibility (no required modifiers, in stock, NOT prescription-only) lives
  // in `isCrossSellEligible` — see src/lib/crossSell.ts for why Rx is excluded.
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
        .filter((i) => isCrossSellEligible(i) && !cartItemIds.has(i.id))
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
        <ThemedStatusBar />
        <View style={styles.emptyVisual} accessible={false}>
          <Icon name="cart" size={38} color={colors.sea} />
        </View>
        <Text style={[styles.emptyTitle, dir.text]}>{t('empty.cart.title')}</Text>
        <Text style={[styles.emptySub, dir.text]}>{t('empty.cart.body')}</Text>
        {nearby.length > 0 && (
          <View style={{ width: '100%', marginTop: 24, paddingHorizontal: 16 }}>
            <Text style={[styles.nearbyTitle, dir.text]}>{t('cart.nearbyTitle')}</Text>
            <View style={{ gap: 10, marginTop: 10 }}>
              {nearby.map((r) => (
                <Pressable
                  key={r.id}
                  onPress={() => {
                    tap();
                    router.push(`/restaurant/${r.id}` as never);
                  }}
                  accessibilityRole="button"
                  accessibilityLabel={`${r.name}, ${r.cuisineLabel}`}
                  style={[styles.nearbyRow, dir.row]}>
                  <Image source={{ uri: r.coverImage }} style={styles.nearbyImg} />
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.nearbyName, dir.text]} numberOfLines={1}>
                      {r.name}
                    </Text>
                    <Text style={[styles.nearbySub, dir.text]} numberOfLines={1}>
                      ★ {formatNumber(r.rating, locale)} · {r.cuisineLabel}
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
      {/* ThemedStatusBar, not <StatusBar style="dark" />: the hardcoded variant
          is what dark mode replaced — it renders dark glyphs on a dark canvas. */}
      <ThemedStatusBar />
      <CartConflictSheet
        visible={conflict !== null}
        savedRestaurantName={conflict?.name ?? ''}
        sameRestaurant={conflict?.sameRestaurant ?? false}
        stale={conflict?.stale ?? false}
        resolving={resolving}
        onKeepLocal={keepLocalCart}
        onUseSaved={useSavedCart}
      />
      <View style={[styles.header, dir.row, { paddingTop: insets.top + 12 }]}>
        <Text style={[styles.title, dir.text]}>{t('cart.title')}</Text>
        <Pressable
          onPress={() => void clearEverywhere()}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel={t('cart.clear')}>
          <Text style={[styles.clear, dir.text]}>{t('cart.clear')}</Text>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 180 }}>
        <View style={styles.card}>
          <Text style={[styles.cardTitle, dir.text]}>
            {t('cart.from', { name: restaurantName ?? '' })}
          </Text>
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
                locale={locale}
              />
            ))}
          </View>
        </View>

        {suggestions.length > 0 && (
          <View style={{ marginTop: 16 }}>
            <Text style={[styles.nearbyTitle, dir.text]}>{t('cart.alsoAdd')}</Text>
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
                    <Text style={styles.suggestPrice}>{formatEgp(item.priceEgp, locale)}</Text>
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
            <Text style={[styles.minText, dir.text]}>
              ⚠ {t('checkout.minOrderShort', { amount: formatEgp(shortBy, locale) })}
            </Text>
          </View>
        )}
        <PrimaryButton
          testID="cart-checkout"
          label={t('cart.checkout', { amount: formatEgp(subtotal, locale) })}
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
  locale: Locale;
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
  locale,
}: RowProps) {
  const styles = useStyles();
  const colors = useThemeColors();
  const dir = useDirection();
  const swipeRef = useRef<Swipeable>(null);

  const renderRightActions = () => (
    <Pressable
      onPress={() => {
        swipeRef.current?.close();
        onRemove();
      }}
      accessibilityRole="button"
      accessibilityLabel={removeLabel}
      style={styles.swipeAction}>
      <Icon name="trash" size={24} color={colors.onStatus} />
      <Text style={styles.swipeLabel}>{removeLabel}</Text>
    </Pressable>
  );

  return (
    <Swipeable ref={swipeRef} renderRightActions={renderRightActions} overshootRight={false}>
      <View style={styles.line}>
        <Pressable
          onPress={onTapEdit}
          accessibilityRole="button"
          accessibilityLabel={line.name}
          style={({ pressed }) => [styles.lineEditBody, dir.row, pressed && { opacity: 0.85 }]}>
          <Image source={{ uri: line.image }} style={styles.ph} />
          <View style={styles.lineContent}>
            <Text style={[styles.lineName, dir.text]} numberOfLines={1}>
              {line.name}
            </Text>
            {line.modifierChoices.length > 0 && (
              <Text style={[styles.mods, dir.text]}>
                {line.modifierChoices.map((c) => c.optionName).join(' · ')}
              </Text>
            )}
            {line.notes && (
              <Text style={[styles.notes, dir.text]}>
                {noteLabel}: {line.notes}
              </Text>
            )}
            {allergyLabels.length > 0 && (
              <Text style={[styles.allergens, dir.text]}>
                ⚠ {allergensPrefix}: {allergyLabels.join(', ')}
              </Text>
            )}
          </View>
        </Pressable>
        <Pressable
          onPress={onRemove}
          hitSlop={10}
          style={[styles.trashBtn, dir.isRtl ? styles.trashBtnRtl : styles.trashBtnLtr]}
          accessibilityRole="button"
          accessibilityLabel={removeLabel}>
          <Icon name="trash" size={19} color={colors.red} />
        </Pressable>
        <View style={[styles.row, dir.row]}>
          <QuantityStepper value={line.quantity} onChange={onChangeQty} min={1} size="sm" />
          <Text style={styles.linePrice}>
            {formatEgp(
              (line.basePriceEgp + line.modifierChoices.reduce((a, c) => a + c.priceDeltaEgp, 0)) *
                line.quantity,
              locale,
            )}
          </Text>
        </View>
      </View>
    </Swipeable>
  );
}

const useStyles = makeStyles((colors) => ({
  emptyWrap: { alignItems: 'center', paddingHorizontal: 24, paddingBottom: 60 },
  emptyVisual: {
    width: 80,
    height: 80,
    borderRadius: radius.xl,
    backgroundColor: colors.seaSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
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
    backgroundColor: colors.surface,
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
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.xl,
    padding: 14,
    ...shadow.soft,
    overflow: 'hidden',
  },
  cardTitle: { fontSize: font.sizes.xl, fontWeight: font.weights.bold, color: colors.ink },
  line: {
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
    backgroundColor: colors.surface,
  },
  lineEditBody: { flex: 1, flexDirection: 'row', gap: 12, alignItems: 'flex-start', paddingEnd: 38 },
  lineContent: { flex: 1 },
  ph: { width: 54, height: 54, borderRadius: radius.md, backgroundColor: colors.bgSoft },
  lineName: { flex: 1, fontSize: font.sizes.xl, fontWeight: font.weights.bold, color: colors.ink },
  trashBtn: {
    position: 'absolute',
    top: 12,
    width: 30,
    height: 30,
    alignItems: 'center',
    justifyContent: 'center',
  },
  trashBtnLtr: { right: 0 },
  trashBtnRtl: { left: 0 },
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
  swipeLabel: { color: colors.onStatus, fontSize: font.sizes.sm, fontWeight: font.weights.bold },
  suggestCard: {
    width: 132,
    backgroundColor: colors.surface,
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
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.line,
  },
}));
