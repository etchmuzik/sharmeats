import { useEffect, useMemo, useState, useCallback } from 'react';
import { Alert, FlatList, Pressable, RefreshControl, Text, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { font, radius, shadow, type Palette } from '../../src/theme';
import { ThemedStatusBar, makeStyles, useThemeColors } from '../../src/themeProvider';
import { EmptyState } from '../../src/components/EmptyState';
import { db } from '../../src/data';
import type { Order, OrderStatus } from '../../src/data/types';
import { useT } from '../../src/i18n';
import { formatEgp, formatTime } from '../../src/lib/format';
import { tap, success } from '../../src/haptics';
import { useCart } from '../../src/store/cart';
import { track } from '../../src/lib/analytics';
import { describeReorderChanges } from '../../src/lib/reorderCheck';
import { prepareReorder, isVerticalDenial } from '../../src/lib/prepareCart';
import { useSession } from '../../src/store/session';
import { useDirection } from '../../src/lib/direction';

const STATUS_LABEL: Record<OrderStatus, string> = {
  placed: 'status.placed',
  accepted: 'status.accepted',
  preparing: 'status.preparing',
  ready: 'status.ready',
  picked_up: 'status.out_for_delivery',
  out_for_delivery: 'status.out_for_delivery',
  delivered: 'status.delivered',
  cancelled: 'status.cancelled',
  rejected: 'status.cancelled',
};

/** Status pill colors, as a function of the active palette. */
function statusColors(colors: Palette): Record<OrderStatus, string> {
  return {
    placed: colors.ink2,
    accepted: colors.sea,
    preparing: colors.sea,
    ready: colors.sea,
    picked_up: colors.accent,
    out_for_delivery: colors.accent,
    delivered: colors.green,
    cancelled: colors.red,
    rejected: colors.red,
  };
}

export default function OrdersTab() {
  const colors = useThemeColors();
  const styles = useStyles();
  const STATUS_COLOR = useMemo(() => statusColors(colors), [colors]);
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const t = useT();
  const locale = useSession((s) => s.locale);
  const dir = useDirection();
  const [active, setActive] = useState<Order[]>([]);
  const [past, setPast] = useState<Order[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  // Order id being revalidated, so the tapped row can show progress and the
  // button cannot be double-fired while the menu fetch is in flight.
  const [reordering, setReordering] = useState<string | null>(null);
  const loadFromOrder = useCart((s) => s.loadFromOrder);

  const reorder = (o: Order) => {
    track('reorder_tapped', { restaurantId: o.restaurantId });
    // Guard: orders placed before mig 055 snapshot their modifier choices WITHOUT
    // optionId, so one-tap reorder would silently drop every add-on and place a
    // cheaper, wrong order. If any line has modifiers but is missing ids, send the
    // user to the restaurant to rebuild it instead of quietly corrupting the cart.
    const hasUnresolvableMods = o.items.some((it) =>
      (it.modifierChoices ?? []).some((c) => !c.optionId),
    );
    if (hasUnresolvableMods) {
      Alert.alert(t('orders.reorderTitle'), t('orders.reorderNeedsRebuild'), [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('orders.reorderOpenMenu'),
          onPress: () => router.push(`/restaurant/${o.restaurantId}`),
        },
      ]);
      return;
    }
    void reorderWithCheck(o);
  };

  /**
   * Reorder against the CURRENT menu, not the prices the past order paid.
   *
   * place_order recomputes every price server-side and raises ITEM_UNAVAILABLE,
   * so money was never at risk — but the customer used to see last month's
   * price all the way to checkout and get rejected at the final tap. Here we
   * reconcile first and say plainly what changed.
   */
  const reorderWithCheck = async (o: Order) => {
    setReordering(o.id);
    try {
      const menu = await db.menus.forRestaurant(o.restaurantId);
      const { lines, changes, allGone, source } = await prepareReorder(
        o.restaurantId,
        o.items,
        menu.items,
      );

      // Bounded issue COUNTS, never the item names or the customer's notes.
      // "how often does a reorder come back changed" is the question; which
      // dish it was is not analytics' business. `prepared_by` distinguishes the
      // authoritative server path from the offline fallback, so a spike in
      // fallbacks is visible rather than looking like clean reorders.
      track('reorder_prepared', {
        source: 'orders_tab',
        prepared_by: source,
        outcome: allGone ? 'all_unavailable' : changes.length > 0 ? 'changed' : 'exact',
        change_count: changes.length,
        line_count: lines.length,
      });

      if (allGone) {
        Alert.alert(t('orders.reorderTitle'), t('orders.reorderAllGone'), [
          { text: t('common.cancel'), style: 'cancel' },
          {
            text: t('orders.reorderOpenMenu'),
            onPress: () => router.push(`/restaurant/${o.restaurantId}`),
          },
        ]);
        return;
      }

      const proceed = () => {
        success();
        loadFromOrder({
          restaurantId: o.restaurantId,
          restaurantName: o.restaurantName,
          lines,
        });
        router.push('/(tabs)/cart');
      };

      if (changes.length === 0) {
        proceed();
        return;
      }

      Alert.alert(
        t('orders.reorderChangesTitle'),
        describeReorderChanges(changes, t, (amount) => formatEgp(amount, locale)),
        [
        { text: t('common.cancel'), style: 'cancel' },
        { text: t('orders.reorderContinue'), onPress: proceed },
        ],
      );
    } catch (e) {
      // A VERTICAL DENIAL IS NOT AN OUTAGE. prepareReorder re-throws
      // VERTICAL_NOT_AVAILABLE, and swallowing it here would load the hidden
      // merchant's basket from the SAVED order anyway -- reintroducing exactly
      // the leak the server gate closes, from the customer's own history.
      if (isVerticalDenial(e)) {
        Alert.alert(t('orders.reorderTitle'), t('orders.reorderUnavailableNow'));
        return;
      }
      // Menu fetch failed (offline). Fall back to the old behaviour rather than
      // blocking the reorder: the server still validates everything, so the
      // worst case is the pre-existing one, not a new failure.
      success();
      loadFromOrder({
        restaurantId: o.restaurantId,
        restaurantName: o.restaurantName,
        lines: o.items,
      });
      router.push('/(tabs)/cart');
    } finally {
      setReordering(null);
    }
  };

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const [a, p] = await Promise.all([db.orders.listActive(), db.orders.listPast()]);
      setActive(a);
      setPast(p);
    } catch {
      // Network/Supabase error — keep whatever we already have rather than
      // wedging the screen. The pull-to-refresh control retries on demand.
    } finally {
      // Always clear the spinner so pull-to-refresh never hangs.
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useFocusEffect(
    useCallback(() => {
      refresh();
    }, [refresh]),
  );

  // Subscribe to active orders so the list updates as status changes.
  //
  // KEYED ON THE IDS, NOT THE ARRAY. This effect used to depend on `active`
  // itself, which is a brand-new array object every time refresh() runs — so:
  //
  //   realtime ping -> refresh() -> setActive(new array) -> identity changed
  //   -> effect tears down every subscription and re-subscribes -> ping -> ...
  //
  // That is the "orders tab keeps refreshing in a loop" report. It needs an
  // active order to bite, and it gets much worse when the order's row is being
  // updated frequently — which is exactly what the dispatch offer/expiry cycle
  // does. Two bugs feeding each other.
  //
  // The set of ids is what the subscriptions actually depend on, and a joined
  // string compares by value, so the effect now re-runs only when an order
  // genuinely enters or leaves the active list.
  const activeIds = useMemo(() => active.map((o) => o.id).join(','), [active]);

  useEffect(() => {
    const ids = activeIds ? activeIds.split(',') : [];
    const unsubs = ids.map((id) =>
      db.orders.subscribe(
        id,
        () => {
          refresh();
        },
        'orders-list',
      ),
    );
    return () => unsubs.forEach((fn) => fn());
  }, [activeIds, refresh]);

  const data = [
    ...(active.length > 0 ? [{ kind: 'header' as const, title: t('orders.titleActive') }] : []),
    ...active.map((o) => ({ kind: 'order' as const, order: o })),
    ...(past.length > 0 ? [{ kind: 'header' as const, title: t('orders.titlePast') }] : []),
    ...past.map((o) => ({ kind: 'order' as const, order: o })),
  ];

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <ThemedStatusBar />
      <View style={[styles.top, { paddingTop: insets.top + 14 }]}>
        <Text style={[styles.title, dir.text]}>{t('tabs.orders')}</Text>
      </View>

      <FlatList
        data={data}
        keyExtractor={(it, i) => (it.kind === 'order' ? it.order.id : `h-${i}`)}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 120 + insets.bottom, gap: 10 }}
        renderItem={({ item }) => {
          if (item.kind === 'header') {
            return <Text style={[styles.sectionH, dir.text]}>{item.title}</Text>;
          }
          const o = item.order;
          const isPast = o.status === 'delivered' || o.status === 'cancelled';
          return (
            <View style={styles.card}>
              <Pressable
                onPress={() => {
                  tap();
                  router.push(`/order/${o.id}` as never);
                }}
                style={({ pressed }) => [pressed && { opacity: 0.9 }]}>
                <View style={[styles.cardTop, dir.row]}>
                  <Text style={[styles.r, dir.text]}>{o.restaurantName}</Text>
                  <View style={[styles.statusPill, { backgroundColor: STATUS_COLOR[o.status] + '22' }]}>
                    <Text style={[styles.statusText, dir.text, { color: STATUS_COLOR[o.status] }]}>
                      {t(STATUS_LABEL[o.status])}
                    </Text>
                  </View>
                </View>
                <Text style={[styles.meta, dir.text]}>
                  {t('orders.itemsCount', { n: o.items.length })} ·{' '}
                  {formatTime(new Date(o.placedAt), locale)} · #{o.shortCode}
                </Text>
                <Text style={[styles.tot, dir.text]}>{formatEgp(o.totalEgp, locale)}</Text>
              </Pressable>
              {isPast && (
                <View style={[styles.bottomRow, dir.row]}>
                  <Pressable
                    onPress={() => reorder(o)}
                    // Disabled while the menu is being revalidated so a second
                    // tap cannot load the cart twice.
                    disabled={reordering === o.id}
                    hitSlop={6}
                    accessibilityRole="button"
                    accessibilityLabel={t('orders.reorder')}
                    style={[styles.reorderBtn, reordering === o.id && styles.reorderBtnBusy]}>
                    <Text style={[styles.reorderText, dir.text]}>
                      {reordering === o.id ? t('orders.reorderChecking') : `↻ ${t('orders.reorder')}`}
                    </Text>
                  </Pressable>
                </View>
              )}
            </View>
          );
        }}
        ListEmptyComponent={
          <EmptyState
            icon="receipt"
            title={t('empty.orders.title')}
            body={t('empty.orders.body')}
            cta={{ label: t('empty.orders.cta'), onPress: () => router.push('/(tabs)/home') }}
          />
        }
      />
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  top: {
    paddingHorizontal: 20,
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  title: { fontSize: 32, fontWeight: font.weights.extrabold, letterSpacing: -0.8, color: colors.ink },
  sectionH: {
    fontSize: font.sizes.xs,
    fontWeight: font.weights.bold,
    color: colors.ink2,
    letterSpacing: 1,
    textTransform: 'uppercase',
    paddingTop: 18,
    paddingBottom: 4,
  },
  card: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.xl,
    padding: 14,
    ...shadow.soft,
  },
  cardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  r: { fontSize: font.sizes['3xl'], fontWeight: font.weights.bold, color: colors.ink, flex: 1 },
  meta: { fontSize: font.sizes.md, color: colors.ink2, marginTop: 4 },
  tot: { fontSize: font.sizes['4xl'], fontWeight: font.weights.extrabold, color: colors.ink, marginTop: 8 },
  bottomRow: { marginTop: 8, flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center' },
  reorderBtn: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    backgroundColor: colors.accentSoft,
    borderRadius: radius.pill,
  },
  reorderBtnBusy: { opacity: 0.6 },
  reorderText: { color: colors.accentDark, fontSize: font.sizes.lg, fontWeight: font.weights.bold },
  statusPill: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: radius.pill },
  statusText: { fontSize: font.sizes.xs, fontWeight: font.weights.bold, letterSpacing: 0.4, textTransform: 'uppercase' },
}));
