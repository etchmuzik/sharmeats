import { useEffect, useState } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Clipboard from 'expo-clipboard';
import { BackButton } from '../../src/components/BackButton';
import { Icon } from '../../src/components/Icon';
import { colors, font, radius, shadow } from '../../src/theme';
import { useT } from '../../src/i18n';
import { db } from '../../src/data';
import type { Order, OrderStatus } from '../../src/data/types';
import { formatEgp, formatTime } from '../../src/lib/format';
import { tap, success } from '../../src/haptics';

const STEPS: { key: OrderStatus; tKey: string }[] = [
  { key: 'placed', tKey: 'order.statusPlaced' },
  { key: 'accepted', tKey: 'order.statusAccepted' },
  { key: 'preparing', tKey: 'order.statusPreparing' },
  { key: 'ready', tKey: 'order.statusReady' },
  { key: 'out_for_delivery', tKey: 'order.statusOnTheWay' },
  { key: 'delivered', tKey: 'order.statusDelivered' },
];

export default function OrderTracking() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const t = useT();
  const [order, setOrder] = useState<Order | null>(null);
  const [now, setNow] = useState(Date.now());
  const [copied, setCopied] = useState(false);
  const [driverLoc, setDriverLoc] = useState<{ lat: number; lng: number } | null>(null);

  const copyShortCode = async (code: string) => {
    await Clipboard.setStringAsync(code);
    success();
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  useEffect(() => {
    if (!id) return;
    db.orders.get(id).then(setOrder);
    const unsub = db.orders.subscribe(id, setOrder);
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      unsub();
      clearInterval(tick);
    };
  }, [id]);

  // Live driver GPS — subscribe only while the order is actually moving
  // (picked up / out for delivery). Cleans up when status changes or unmounts.
  const trackingDriver =
    order?.status === 'out_for_delivery' || order?.status === 'picked_up';
  useEffect(() => {
    if (!id || !trackingDriver) {
      setDriverLoc(null);
      return;
    }
    const unsub = db.orders.subscribeDriverLocation(id, (loc) =>
      setDriverLoc({ lat: loc.lat, lng: loc.lng }),
    );
    return () => unsub();
  }, [id, trackingDriver]);

  if (!order) {
    return (
      <View style={styles.loading}>
        <StatusBar style="dark" />
        <Text style={{ color: colors.ink3 }}>{t('common.loading')}</Text>
      </View>
    );
  }

  const stepIndex = STEPS.findIndex((s) => s.key === order.status);
  const remainingMs = order.etaAt - now;
  const remainingMin = Math.max(0, Math.ceil(remainingMs / 60_000));
  const slaCreditEgp = Math.round(order.totalEgp * 0.1);

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <StatusBar style="light" />

      {/* Mock map */}
      <View style={styles.map}>
        <View style={[styles.road, styles.r1]} />
        <View style={[styles.road, styles.r2]} />
        <View style={[styles.road, styles.r3]} />
        <View style={styles.routeLine} />
        <View style={styles.pinRider}>
          <View style={[styles.riderDot, driverLoc && styles.riderDotLive]} />
          {driverLoc && (
            <View style={styles.liveBadge}>
              <View style={styles.liveDot} />
              <Text style={styles.liveText}>LIVE</Text>
            </View>
          )}
        </View>
        <View style={styles.pinDest}>
          <Icon name="location" size={28} color={colors.accent} accessibilityLabel="Your delivery location" />
        </View>
        <View style={[styles.mapNav, { top: insets.top + 6 }]}>
          <BackButton tint="light" onPress={() => router.replace('/(tabs)/orders')} />
        </View>
      </View>

      <ScrollView
        style={styles.sheet}
        contentContainerStyle={{ padding: 20, paddingBottom: 60 + insets.bottom }}>
        <View style={styles.grabber} />

        <View style={styles.etaRow}>
          <View style={{ flex: 1 }}>
            {order.scheduledFor ? (
              <>
                <Text style={styles.etaLbl}>{t('order.scheduledFor')}</Text>
                <Text style={styles.etaBig}>
                  {formatTime(new Date(order.scheduledFor))}
                </Text>
              </>
            ) : (
              <>
                <Text style={styles.etaLbl}>{t('order.arriving')}</Text>
                <Text style={styles.etaBig}>
                  {order.status === 'delivered' ? '✓' : remainingMin}{' '}
                  <Text style={styles.etaMin}>
                    {order.status === 'delivered' ? t('order.delivered') : t('order.min')}
                  </Text>
                </Text>
              </>
            )}
          </View>
          <View style={{ alignItems: 'flex-end' }}>
            <View style={styles.slaChip}>
              <Text style={styles.slaText}>{t('order.slaChip')}</Text>
            </View>
            <Pressable onPress={() => copyShortCode(order.shortCode)} hitSlop={8}>
              <Text style={styles.orderRef}>
                #{order.shortCode}{' '}
                <Text style={{ color: copied ? colors.green : colors.sea, fontWeight: '700' }}>
                  {copied ? t('order.copied') : t('order.copy')}
                </Text>
              </Text>
            </Pressable>
          </View>
        </View>

        <Text style={styles.slaLine}>
          {t('order.slaLine', {
            time: formatTime(new Date(order.etaAt)),
            credit: formatEgp(slaCreditEgp),
          })}
        </Text>

        {/* Timeline */}
        <View style={styles.timeline}>
          {STEPS.map((s, i) => {
            const status = i < stepIndex ? 'done' : i === stepIndex ? 'now' : 'pending';
            const histEntry = order.history.find((h) => h.status === s.key);
            const isOnTheWay = s.key === 'out_for_delivery';
            return (
              <View key={s.key} style={styles.step}>
                {i > 0 && (
                  <View
                    style={[
                      styles.connector,
                      (status === 'done' || (i <= stepIndex && i > 0)) && { backgroundColor: colors.green },
                    ]}
                  />
                )}
                <View
                  style={[
                    styles.bullet,
                    status === 'done' && { backgroundColor: colors.green, borderColor: colors.green },
                    status === 'now' && { backgroundColor: colors.accent, borderColor: colors.accent },
                  ]}>
                  {status === 'done' && <Text style={styles.bulletCheck}>✓</Text>}
                  {status === 'now' && <View style={styles.bulletNow} />}
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.stTitle, status === 'pending' && { color: colors.ink3, fontWeight: font.weights.medium }]}>
                    {isOnTheWay
                      ? t('order.statusOnTheWay', { rider: order.rider?.name ?? 'Rider' })
                      : t(s.tKey)}
                  </Text>
                  {histEntry && <Text style={styles.stTime}>{formatTime(new Date(histEntry.at))}{histEntry.note ? ` · ${histEntry.note}` : ''}</Text>}
                </View>
              </View>
            );
          })}
        </View>

        {/* Kitchen briefing echo */}
        {((order.aggregateAllergens && order.aggregateAllergens.length > 0) || order.kitchenNotes) && (
          <View style={styles.briefingCard}>
            <Text style={styles.briefingTitle}>👩‍🍳 {t('order.kitchenSees')}</Text>
            {order.aggregateAllergens && order.aggregateAllergens.length > 0 && (
              <Text style={styles.briefingAllergens}>
                ⚠ {t('cart.allergensPrefix')}:{' '}
                {order.aggregateAllergens.map((a) => t(`allergy.${a}`)).join(', ')}
              </Text>
            )}
            {order.kitchenNotes && <Text style={styles.briefingNotes}>{order.kitchenNotes}</Text>}
          </View>
        )}

        {/* Rider card */}
        {order.rider && (
          <View style={styles.riderCard}>
            <Image source={{ uri: order.rider.photo }} style={styles.riderPh} />
            <View style={{ flex: 1 }}>
              <View style={styles.riderNameRow}>
                <Text style={styles.riderName}>{order.rider.name}</Text>
                <Text style={styles.verified}>✓</Text>
              </View>
              <View style={styles.riderMeta}>
                <Text style={styles.riderMetaText}>{order.rider.vehicle}</Text>
                <Text style={styles.riderMetaText}>·</Text>
                <View style={styles.plate}>
                  <Text style={styles.plateText}>{order.rider.plate}</Text>
                </View>
                <Text style={styles.riderMetaText}>·</Text>
                <Text style={styles.riderMetaText}>★ {order.rider.rating.toFixed(1)}</Text>
              </View>
            </View>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <Pressable
                onPress={() => tap()}
                accessibilityRole="button"
                accessibilityLabel={t('order.callDriver')}
                style={[styles.actBtn, { backgroundColor: colors.green }]}>
                <Icon name="phone" size={20} color={colors.white} />
              </Pressable>
              <Pressable
                onPress={() => tap()}
                accessibilityRole="button"
                accessibilityLabel={t('order.messageDriver')}
                style={[styles.actBtn, { backgroundColor: '#25D366' }]}>
                <Icon name="chat" size={20} color={colors.white} />
              </Pressable>
            </View>
          </View>
        )}

        {/* Order summary */}
        <View style={styles.summary}>
          <Text style={styles.summaryTitle}>{order.restaurantName}</Text>
          {order.items.map((it) => (
            <View key={it.lineId} style={styles.summaryLine}>
              <Text style={styles.summaryQ}>{it.quantity}×</Text>
              <Text style={{ flex: 1, fontSize: font.sizes.lg, color: colors.ink }}>{it.name}</Text>
            </View>
          ))}
          <View style={styles.summaryTotal}>
            <Text style={{ fontSize: font.sizes['2xl'], fontWeight: font.weights.bold, color: colors.ink }}>
              {t('checkout.total')}
            </Text>
            <Text style={{ fontSize: font.sizes['2xl'], fontWeight: font.weights.extrabold, color: colors.ink }}>
              {formatEgp(order.totalEgp)}
            </Text>
          </View>
          <Text style={styles.summarySub}>
            Paid · {order.paymentLabel}
          </Text>
        </View>

        {order.status === 'delivered' && (
          <Pressable
            onPress={() => router.push(`/order/${order.id}/review`)}
            style={styles.reviewBtn}>
            <Text style={styles.reviewBtnText}>★ {t('order.rateOrder')}</Text>
          </Pressable>
        )}

        {order.status !== 'delivered' && (
          <Pressable
            onPress={async () => {
              const o = await db.orders.forceDelivered(order.id);
              if (o) setOrder(o);
            }}
            style={styles.debugBtn}>
            <Text style={styles.debugText}>{t('order.markDelivered')}</Text>
          </Pressable>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  loading: { flex: 1, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center' },
  map: {
    height: 280,
    backgroundColor: '#cfe1e5',
    position: 'relative',
    overflow: 'hidden',
  },
  road: { position: 'absolute', backgroundColor: '#fff', borderRadius: 6, opacity: 0.92 },
  r1: { left: -50, right: -50, top: '55%', height: 14, transform: [{ rotate: '-6deg' }] },
  r2: { left: '62%', top: -50, bottom: -50, width: 12, transform: [{ rotate: '8deg' }] },
  r3: { left: '10%', top: '18%', width: '38%', height: 8, transform: [{ rotate: '18deg' }] },
  routeLine: {
    position: 'absolute',
    left: '30%',
    top: '50%',
    width: '50%',
    height: 0,
    borderTopWidth: 3,
    borderColor: colors.accent,
    borderStyle: 'dashed',
    transform: [{ rotate: '-22deg' }],
  },
  pinRider: { position: 'absolute', left: '28%', top: '48%', alignItems: 'center' },
  riderDot: { width: 18, height: 18, borderRadius: 9, backgroundColor: colors.accent, borderWidth: 3, borderColor: '#fff' },
  riderDotLive: { backgroundColor: colors.green },
  liveBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 4,
    backgroundColor: colors.ink,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 999,
  },
  liveDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.green },
  liveText: { color: '#fff', fontSize: 9, fontWeight: '800', letterSpacing: 0.5 },
  pinDest: { position: 'absolute', left: '72%', top: '30%' },
  mapNav: { position: 'absolute', left: 14 },

  sheet: {
    flex: 1,
    backgroundColor: colors.white,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    marginTop: -22,
  },
  grabber: { width: 38, height: 4, borderRadius: 2, backgroundColor: colors.line, alignSelf: 'center', marginBottom: 14 },

  etaRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end' },
  etaLbl: { fontSize: font.sizes.sm, color: colors.ink2, fontWeight: font.weights.bold, letterSpacing: 0.6, textTransform: 'uppercase' },
  etaBig: { fontSize: 36, fontWeight: font.weights.extrabold, color: colors.ink, marginTop: 4, letterSpacing: -1 },
  etaMin: { fontSize: font.sizes.lg, color: colors.ink2, fontWeight: font.weights.bold },
  slaChip: { backgroundColor: colors.seaSoft, paddingHorizontal: 10, paddingVertical: 6, borderRadius: radius.pill },
  slaText: { color: colors.sea, fontSize: font.sizes.sm, fontWeight: font.weights.bold },
  orderRef: { marginTop: 6, fontSize: font.sizes.lg, color: colors.ink2, fontWeight: '700' as const, letterSpacing: 0.4 },
  slaLine: { marginTop: 10, fontSize: font.sizes.md, color: colors.ink2, lineHeight: 18 },

  timeline: { marginTop: 18 },
  step: { flexDirection: 'row', gap: 12, paddingVertical: 6, position: 'relative' },
  connector: { position: 'absolute', left: 10, top: -2, width: 2, height: 12, backgroundColor: colors.line },
  bullet: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: colors.white,
    borderWidth: 2,
    borderColor: colors.line,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bulletCheck: { color: colors.white, fontSize: 12, lineHeight: 12, fontWeight: '900' as const },
  bulletNow: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.white },
  stTitle: { fontSize: font.sizes.lg, fontWeight: font.weights.bold, color: colors.ink },
  stTime: { fontSize: font.sizes.sm, color: colors.ink2, marginTop: 2 },

  briefingCard: {
    marginTop: 18,
    padding: 14,
    borderRadius: radius.xl,
    backgroundColor: colors.bgSoft,
    borderWidth: 1,
    borderColor: colors.line,
  },
  briefingTitle: { fontSize: font.sizes['2xl'], fontWeight: font.weights.bold, color: colors.ink },
  briefingAllergens: {
    marginTop: 8,
    fontSize: font.sizes.lg,
    color: colors.red,
    fontWeight: font.weights.bold,
  },
  briefingNotes: { marginTop: 6, fontSize: font.sizes.lg, color: colors.ink2, lineHeight: 22 },
  riderCard: {
    marginTop: 18,
    padding: 14,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.xl,
    backgroundColor: colors.bgSoft2,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  riderPh: { width: 54, height: 54, borderRadius: 27, borderWidth: 3, borderColor: colors.white, ...shadow.soft },
  riderNameRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  riderName: { fontSize: font.sizes.xl, fontWeight: font.weights.extrabold, color: colors.ink },
  verified: { color: colors.sea, fontSize: 12, fontWeight: '900' as const },
  riderMeta: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4, flexWrap: 'wrap' },
  riderMetaText: { fontSize: font.sizes.md, color: colors.ink2 },
  plate: { backgroundColor: colors.ink, paddingHorizontal: 7, paddingVertical: 3, borderRadius: 4 },
  plateText: { color: colors.white, fontSize: 10.5, fontWeight: '900' as const, letterSpacing: 0.6 },
  actBtn: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center' },
  actIcon: { fontSize: 18 },

  summary: {
    marginTop: 18,
    padding: 14,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.xl,
    backgroundColor: colors.white,
  },
  summaryTitle: { fontSize: font.sizes['2xl'], fontWeight: font.weights.bold, color: colors.ink, marginBottom: 8 },
  summaryLine: { flexDirection: 'row', gap: 10, paddingVertical: 4 },
  summaryQ: { fontSize: font.sizes.lg, fontWeight: font.weights.bold, color: colors.ink2, width: 26 },
  summaryTotal: {
    marginTop: 8,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: colors.line,
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  summarySub: { marginTop: 4, color: colors.ink2, fontSize: font.sizes.md },

  reviewBtn: {
    marginTop: 18,
    backgroundColor: colors.accent,
    padding: 14,
    borderRadius: radius.xl,
    alignItems: 'center',
  },
  reviewBtnText: { color: colors.white, fontSize: font.sizes.xl, fontWeight: font.weights.bold },

  debugBtn: {
    marginTop: 18,
    padding: 12,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colors.line2,
    alignItems: 'center',
  },
  debugText: { color: colors.ink2, fontSize: font.sizes.md, fontWeight: font.weights.bold },
});
