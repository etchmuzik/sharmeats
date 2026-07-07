import { useCallback, useEffect, useState } from 'react';
import { AppState, StyleSheet, Text, View } from 'react-native';
import { usePathname, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { db } from '../data';
import type { Order } from '../data/types';
import { useT } from '../i18n';
import { useDirection } from '../lib/direction';
import { formatTime } from '../lib/format';
import { colors, font, radius, shadow } from '../theme';
import { PressableScale } from './PressableScale';

// TabBar floats at `bottom: max(insets.bottom, 14)` with a 52px pill height —
// anchor this banner just above it so the two never overlap.
const TAB_BAR_HEIGHT = 52;
const TAB_BAR_GAP = 10;

const TERMINAL: Order['status'][] = ['delivered', 'cancelled', 'rejected'];

/**
 * Persistent "order in flight" pill shown above the tab bar (Talabat-style).
 * Mounted only inside the tabs layout, so the dedicated tracking screen never
 * shows a duplicate. Best-effort: any load error simply hides the banner.
 */
export function ActiveOrderBanner() {
  const router = useRouter();
  const pathname = usePathname();
  const t = useT();
  const dir = useDirection();
  const insets = useSafeAreaInsets();
  const [order, setOrder] = useState<Order | null>(null);
  const [now, setNow] = useState(Date.now());

  const load = useCallback(async () => {
    try {
      const active = await db.orders.listActive();
      setOrder(active[0] ?? null);
    } catch {
      // Banner is decorative — never surface errors here.
    }
  }, []);

  // Reload on mount, on every tab change (cheap single query — catches orders
  // placed moments ago), and when the app returns to the foreground (Realtime
  // sockets drop in background).
  useEffect(() => {
    load();
  }, [load, pathname]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') load();
    });
    return () => sub.remove();
  }, [load]);

  // Live status for the order we're showing; when it terminates, look for the
  // next active order (or hide).
  useEffect(() => {
    if (!order?.id) return;
    const unsub = db.orders.subscribe(order.id, (o) => {
      if (TERMINAL.includes(o.status)) load();
      else setOrder(o);
    });
    return unsub;
  }, [order?.id, load]);

  // Tick the countdown once a minute while visible.
  useEffect(() => {
    if (!order) return;
    const iv = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(iv);
  }, [order?.id]);

  if (!order) return null;

  const remainingMin = Math.max(0, Math.ceil((order.etaAt - now) / 60_000));
  const etaText = order.scheduledFor
    ? formatTime(new Date(order.scheduledFor))
    : t('banner.etaMin', { n: remainingMin });

  return (
    <PressableScale
      haptic="tap"
      onPress={() => {
        router.push(`/order/${order.id}`);
      }}
      accessibilityRole="button"
      accessibilityLabel={`${t(`status.${order.status}`)} · ${order.restaurantName}`}
      style={[
        styles.wrap,
        dir.row,
        { bottom: Math.max(insets.bottom, 14) + TAB_BAR_HEIGHT + TAB_BAR_GAP },
      ]}>
      <View style={styles.pulse} />
      <View style={{ flex: 1 }}>
        <Text style={[styles.status, dir.text]} numberOfLines={1}>
          {t(`status.${order.status}`)} · {etaText}
        </Text>
        <Text style={[styles.restaurant, dir.text]} numberOfLines={1}>
          {order.restaurantName}
        </Text>
      </View>
      <View style={styles.trackBtn}>
        <Text style={styles.trackText}>{t('banner.track')}</Text>
      </View>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: 14,
    right: 14,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: radius.xl,
    backgroundColor: colors.ink,
    alignItems: 'center',
    gap: 10,
    ...shadow.card,
  },
  pulse: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: colors.green,
  },
  status: { color: colors.white, fontSize: font.sizes.md, fontWeight: font.weights.bold },
  restaurant: { color: 'rgba(255,255,255,0.75)', fontSize: font.sizes.sm, marginTop: 1 },
  trackBtn: {
    backgroundColor: colors.accent,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: radius.pill,
  },
  trackText: { color: colors.white, fontSize: font.sizes.sm, fontWeight: font.weights.bold },
});
