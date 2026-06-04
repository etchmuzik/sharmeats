import { useEffect, useState, useCallback } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, font, radius, shadow } from '../../src/theme';
import { db } from '../../src/data';
import type { Order, OrderStatus } from '../../src/data/types';
import { useT } from '../../src/i18n';
import { formatEgp, formatTime } from '../../src/lib/format';
import { tap, success } from '../../src/haptics';
import { useCart } from '../../src/store/cart';

const STATUS_LABEL: Record<OrderStatus, string> = {
  placed: 'status.placed',
  accepted: 'status.accepted',
  preparing: 'status.preparing',
  ready: 'status.ready',
  out_for_delivery: 'status.out_for_delivery',
  delivered: 'status.delivered',
  cancelled: 'status.cancelled',
};

const STATUS_COLOR: Record<OrderStatus, string> = {
  placed: colors.ink2,
  accepted: colors.sea,
  preparing: colors.sea,
  ready: colors.sea,
  out_for_delivery: colors.accent,
  delivered: colors.green,
  cancelled: colors.red,
};

export default function OrdersTab() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const t = useT();
  const [active, setActive] = useState<Order[]>([]);
  const [past, setPast] = useState<Order[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const loadFromOrder = useCart((s) => s.loadFromOrder);

  const reorder = (o: Order) => {
    success();
    loadFromOrder({
      restaurantId: o.restaurantId,
      restaurantName: o.restaurantName,
      lines: o.items,
    });
    router.push('/(tabs)/cart');
  };

  const refresh = useCallback(async () => {
    setRefreshing(true);
    const [a, p] = await Promise.all([db.orders.listActive(), db.orders.listPast()]);
    setActive(a);
    setPast(p);
    setRefreshing(false);
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
  useEffect(() => {
    const unsubs = active.map((o) =>
      db.orders.subscribe(o.id, () => {
        refresh();
      }),
    );
    return () => unsubs.forEach((fn) => fn());
  }, [active, refresh]);

  const data = [
    ...(active.length > 0 ? [{ kind: 'header' as const, title: t('orders.titleActive') }] : []),
    ...active.map((o) => ({ kind: 'order' as const, order: o })),
    ...(past.length > 0 ? [{ kind: 'header' as const, title: t('orders.titlePast') }] : []),
    ...past.map((o) => ({ kind: 'order' as const, order: o })),
  ];

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <StatusBar style="dark" />
      <View style={[styles.top, { paddingTop: insets.top + 14 }]}>
        <Text style={styles.title}>{t('tabs.orders')}</Text>
      </View>

      <FlatList
        data={data}
        keyExtractor={(it, i) => (it.kind === 'order' ? it.order.id : `h-${i}`)}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 120 + insets.bottom, gap: 10 }}
        renderItem={({ item }) => {
          if (item.kind === 'header') {
            return <Text style={styles.sectionH}>{item.title}</Text>;
          }
          const o = item.order;
          const isPast = o.status === 'delivered' || o.status === 'cancelled';
          return (
            <Pressable
              onPress={() => {
                tap();
                router.push(`/order/${o.id}` as never);
              }}
              style={({ pressed }) => [styles.card, pressed && { opacity: 0.9 }]}>
              <View style={styles.cardTop}>
                <Text style={styles.r}>{o.restaurantName}</Text>
                <View style={[styles.statusPill, { backgroundColor: STATUS_COLOR[o.status] + '22' }]}>
                  <Text style={[styles.statusText, { color: STATUS_COLOR[o.status] }]}>
                    {t(STATUS_LABEL[o.status])}
                  </Text>
                </View>
              </View>
              <Text style={styles.meta}>
                {t('orders.itemsCount', { n: o.items.length })} ·{' '}
                {formatTime(new Date(o.placedAt))} · #{o.shortCode}
              </Text>
              <View style={styles.bottomRow}>
                <Text style={styles.tot}>{formatEgp(o.totalEgp)}</Text>
                {isPast && (
                  <Pressable
                    onPress={(e) => {
                      e.stopPropagation();
                      reorder(o);
                    }}
                    hitSlop={6}
                    style={styles.reorderBtn}>
                    <Text style={styles.reorderText}>↻ {t('orders.reorder')}</Text>
                  </Pressable>
                )}
              </View>
            </Pressable>
          );
        }}
        ListEmptyComponent={
          <View style={{ paddingTop: 60, alignItems: 'center' }}>
            <Text style={{ fontSize: 56 }}>🧾</Text>
            <Text style={{ marginTop: 12, color: colors.ink3, fontSize: font.sizes.xl }}>
              {t('orders.empty')}
            </Text>
          </View>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
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
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.xl,
    padding: 14,
    ...shadow.soft,
  },
  cardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  r: { fontSize: font.sizes['3xl'], fontWeight: font.weights.bold, color: colors.ink, flex: 1 },
  meta: { fontSize: font.sizes.md, color: colors.ink2, marginTop: 4 },
  tot: { fontSize: font.sizes['4xl'], fontWeight: font.weights.extrabold, color: colors.ink },
  bottomRow: { marginTop: 8, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  reorderBtn: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    backgroundColor: colors.accentSoft,
    borderRadius: radius.pill,
  },
  reorderText: { color: colors.accentDark, fontSize: font.sizes.lg, fontWeight: font.weights.bold },
  statusPill: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: radius.pill },
  statusText: { fontSize: font.sizes.xs, fontWeight: font.weights.bold, letterSpacing: 0.4, textTransform: 'uppercase' },
});
