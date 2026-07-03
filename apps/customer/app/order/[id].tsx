import { useEffect, useRef, useState } from 'react';
import { Alert, Image, Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Clipboard from 'expo-clipboard';
import MapView, { Marker } from 'react-native-maps';
import { BackButton } from '../../src/components/BackButton';
import { Icon } from '../../src/components/Icon';
import { colors, font, radius, shadow } from '../../src/theme';
import { useT } from '../../src/i18n';
import { db } from '../../src/data';
import type { Order, OrderStatus, Restaurant } from '../../src/data/types';
import { formatEgp, formatTime } from '../../src/lib/format';
import { tap, success } from '../../src/haptics';
import { track } from '../../src/lib/analytics';
import { ScreenErrorBoundary } from '../../src/components/ScreenErrorBoundary';
import { SHARM_CENTER, type LatLng } from '../../src/components/MapPinPicker';
import { isDriverLocationStale, vehicleIconName } from '../../src/lib/tracking';

// Expo Router renders this instead of crashing if anything throws while the
// tracking screen renders — the user gets a retry screen and we report the error.
export { ScreenErrorBoundary as ErrorBoundary };

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
  const [restaurant, setRestaurant] = useState<Restaurant | null>(null);
  const [now, setNow] = useState(Date.now());
  const [copied, setCopied] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [driverLoc, setDriverLoc] = useState<{ lat: number; lng: number; at: number } | null>(null);
  const mapRef = useRef<MapView | null>(null);

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

  // Fetch the restaurant once we know which one, to show its contact card
  // (phone/address) HERE — contact info is gated behind a placed order, not
  // exposed while browsing. Best-effort: a failure just hides the card.
  useEffect(() => {
    if (!order?.restaurantId) return;
    db.restaurants
      .get(order.restaurantId)
      .then(setRestaurant)
      .catch(() => setRestaurant(null));
  }, [order?.restaurantId]);

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
      setDriverLoc({ lat: loc.lat, lng: loc.lng, at: loc.at }),
    );
    return () => unsub();
  }, [id, trackingDriver]);

  // Computed here (before the `!order` early return) because the camera
  // auto-fit effect below is an unconditional hook and needs these values;
  // optional chaining covers the case where `order` hasn't loaded yet.
  const destination: LatLng = {
    lat: order?.addressSnapshot.lat ?? SHARM_CENTER.lat,
    lng: order?.addressSnapshot.lng ?? SHARM_CENTER.lng,
  };

  // Keep both the driver and the destination pin in view as the driver moves.
  useEffect(() => {
    if (!driverLoc || !mapRef.current) return;
    mapRef.current.fitToCoordinates(
      [
        { latitude: driverLoc.lat, longitude: driverLoc.lng },
        { latitude: destination.lat, longitude: destination.lng },
      ],
      { edgePadding: { top: 60, right: 60, bottom: 60, left: 60 }, animated: true },
    );
  }, [driverLoc, destination.lat, destination.lng]);

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
  const isCancelled = order.status === 'cancelled' || order.status === 'rejected';
  // Customers may only cancel before the restaurant accepts; once a card order
  // is paid, cancellation implies a refund flow we don't have yet — hide it.
  const canCancel = order.status === 'placed' && order.paymentStatus !== 'paid';
  const driverIsStale = driverLoc ? isDriverLocationStale(driverLoc.at, now) : false;

  const confirmCancel = () => {
    tap();
    Alert.alert(t('order.cancelConfirmTitle'), t('order.cancelConfirmBody'), [
      { text: t('order.cancelKeep'), style: 'cancel' },
      {
        text: t('order.cancelConfirmYes'),
        style: 'destructive',
        onPress: async () => {
          setCancelling(true);
          try {
            await db.orders.cancel(order.id);
            track('order_cancelled', { orderId: order.id, total: order.totalEgp });
            const fresh = await db.orders.get(order.id);
            if (fresh) setOrder(fresh);
          } catch {
            Alert.alert(t('order.cancelFailed'));
          } finally {
            setCancelling(false);
          }
        },
      },
    ]);
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <StatusBar style="light" />

      <View style={styles.map}>
        <MapView
          ref={mapRef}
          style={StyleSheet.absoluteFillObject}
          initialRegion={{
            latitude: destination.lat,
            longitude: destination.lng,
            latitudeDelta: 0.04,
            longitudeDelta: 0.04,
          }}>
          <Marker
            coordinate={{ latitude: destination.lat, longitude: destination.lng }}
            anchor={{ x: 0.5, y: 0.5 }}>
            <View style={styles.destMarker}>
              <Icon name="location" size={20} color={colors.white} accessibilityLabel="Your delivery location" />
            </View>
          </Marker>
          {driverLoc && order.rider && (
            <Marker
              coordinate={{ latitude: driverLoc.lat, longitude: driverLoc.lng }}
              anchor={{ x: 0.5, y: 0.5 }}>
              <View style={[styles.riderMarker, driverIsStale && styles.riderMarkerStale]}>
                <Icon name={vehicleIconName(order.rider.vehicle)} size={18} color={colors.white} accessibilityLabel="Your driver" />
              </View>
            </Marker>
          )}
        </MapView>
        {driverLoc && (
          <View style={styles.liveBadge}>
            <View style={[styles.liveDot, driverIsStale && { backgroundColor: colors.amber }]} />
            <Text style={styles.liveText}>
              {driverIsStale ? t('order.trackingReconnecting') : 'LIVE'}
            </Text>
          </View>
        )}
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
            {isCancelled ? (
              <>
                <Text style={styles.etaLbl}>{t('order.tracking')}</Text>
                <Text style={[styles.etaBig, { color: colors.red }]}>
                  {t(order.status === 'rejected' ? 'status.rejected' : 'status.cancelled')}
                </Text>
              </>
            ) : order.scheduledFor ? (
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
            {!isCancelled && (
              <View style={styles.slaChip}>
                <Text style={styles.slaText}>{t('order.slaChip')}</Text>
              </View>
            )}
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

        {!isCancelled && (
          <Text style={styles.slaLine}>
            {t('order.slaLine', {
              time: formatTime(new Date(order.etaAt)),
              credit: formatEgp(slaCreditEgp),
            })}
          </Text>
        )}

        {/* Cancelled / rejected terminal state replaces the step timeline. */}
        {isCancelled && (
          <View style={styles.cancelledCard}>
            <Text style={styles.cancelledTitle}>{t('order.cancelledTitle')}</Text>
            <Text style={styles.cancelledBody}>
              {t(order.status === 'rejected' ? 'order.rejectedBody' : 'order.cancelledBody')}
            </Text>
          </View>
        )}

        {/* Timeline */}
        {!isCancelled && (
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
        )}

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

        {/* Hotel handoff reassurance — for tourists, confirm the order is going
            to their room with no phone call needed (the core trust promise). */}
        {!isCancelled && order.addressSnapshot?.kind === 'hotel' && (
          <View style={styles.handoffCard}>
            <View style={styles.handoffHead}>
              <Icon name="hotel" size={16} color={colors.sea} />
              <Text style={styles.handoffTitle}>
                {order.addressSnapshot.hotelName ?? t('address.hotel')}
                {order.addressSnapshot.roomNumber
                  ? ` · ${t('address.room')} ${order.addressSnapshot.roomNumber}`
                  : ''}
              </Text>
            </View>
            <Text style={styles.handoffLine}>
              {handoffLabel(order.addressSnapshot.handoff, t)}
            </Text>
            <View style={styles.handoffBadge}>
              <Text style={styles.handoffBadgeText}>{t('order.noCallNeeded')}</Text>
            </View>
          </View>
        )}

        {/* Rider card */}
        {!isCancelled && order.rider && (
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
                <Text style={styles.riderMetaText}>
                  ★ {(order.rider.rating ?? 5).toFixed(1)}
                </Text>
              </View>
            </View>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <Pressable
                onPress={() => {
                  tap();
                  router.push(`/order/${order.id}/chat`);
                }}
                accessibilityRole="button"
                accessibilityLabel={t('order.messageInApp')}
                style={[styles.actBtn, { backgroundColor: colors.accent }]}>
                <Icon name="chat" size={20} color={colors.white} />
              </Pressable>
              <Pressable
                onPress={() => contactRider('call', order.rider?.phone)}
                accessibilityRole="button"
                accessibilityLabel={t('order.callDriver')}
                style={[styles.actBtn, { backgroundColor: colors.green }]}>
                <Icon name="phone" size={20} color={colors.white} />
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
            {(order.paymentStatus === 'paid' ? t('order.paid') : t('order.payOnDelivery'))} ·{' '}
            {order.paymentLabel}
          </Text>
        </View>

        {/* Restaurant contact — shown only here (post-order), never while
            browsing. Lets the customer reach the venue about THIS order. */}
        {!isCancelled && restaurant && (
          <View style={styles.contactCard}>
            {restaurant.address && (
              <Text style={styles.contactAddr} numberOfLines={2}>
                📍 {restaurant.address}
              </Text>
            )}
            <View style={styles.contactActions}>
              <Pressable
                onPress={() => {
                  tap();
                  router.push(`/order/${order.id}/chat`);
                }}
                accessibilityRole="button"
                accessibilityLabel={t('order.messageRestaurant')}
                style={styles.contactBtn}>
                <Text style={styles.contactBtnText}>💬 {t('order.messageRestaurant')}</Text>
              </Pressable>
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
                    const q = encodeURIComponent(
                      `${restaurant.name} ${restaurant.address ?? ''}`.trim(),
                    );
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

        {order.status === 'delivered' && (
          <Pressable
            onPress={() => router.push(`/order/${order.id}/review`)}
            style={styles.reviewBtn}>
            <Text style={styles.reviewBtnText}>★ {t('order.rateOrder')}</Text>
          </Pressable>
        )}

        {canCancel && (
          <Pressable
            onPress={confirmCancel}
            disabled={cancelling}
            accessibilityRole="button"
            accessibilityLabel={t('order.cancelOrder')}
            style={[styles.cancelBtn, cancelling && { opacity: 0.5 }]}>
            <Text style={styles.cancelBtnText}>{t('order.cancelOrder')}</Text>
          </Pressable>
        )}

        <Pressable
          onPress={() => {
            tap();
            router.push(`/help?orderCode=${order.shortCode}`);
          }}
          accessibilityRole="button"
          accessibilityLabel={t('order.getHelp')}
          style={styles.helpLink}>
          <Text style={styles.helpLinkText}>{t('order.getHelp')}</Text>
        </Pressable>

        {/* Dev-only shortcut to fast-forward an order to delivered. __DEV__ is
            false in production builds, so a real customer never sees this — in
            the live (Supabase) backend forceDelivered is a no-op anyway. */}
        {__DEV__ && order.status !== 'delivered' && !isCancelled && (
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

/**
 * Open the device dialer (tel:) or WhatsApp (with SMS fallback) to reach the
 * driver. No-ops with light haptic feedback if we have no phone number yet
 * (e.g. before a driver has accepted and the rider snapshot is filled).
 */
async function contactRider(mode: 'call' | 'whatsapp', phone?: string): Promise<void> {
  tap();
  const num = (phone ?? '').replace(/[^\d+]/g, '');
  if (!num) return;
  const candidates =
    mode === 'call'
      ? [`tel:${num}`]
      : [`whatsapp://send?phone=${num.replace(/^\+/, '')}`, `sms:${num}`];
  for (const url of candidates) {
    try {
      if (await Linking.canOpenURL(url)) {
        await Linking.openURL(url);
        return;
      }
    } catch {
      // try the next candidate
    }
  }
}

/** Plain-language handoff line for the customer, reusing the address.* labels. */
function handoffLabel(
  handoff: 'lobby' | 'reception' | 'poolside' | undefined,
  t: (key: string, vars?: Record<string, string | number>) => string,
): string {
  switch (handoff) {
    case 'lobby':
      return t('address.lobby');
    case 'reception':
      return t('address.reception');
    case 'poolside':
      return t('address.poolside');
    default:
      return t('order.deliveringToRoom');
  }
}

const styles = StyleSheet.create({
  loading: { flex: 1, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center' },
  map: {
    height: 280,
    backgroundColor: '#cfe1e5',
    position: 'relative',
    overflow: 'hidden',
  },
  destMarker: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 3,
    borderColor: colors.white,
  },
  riderMarker: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: colors.green,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 3,
    borderColor: colors.white,
  },
  riderMarkerStale: {
    backgroundColor: colors.amber,
  },
  liveBadge: {
    position: 'absolute',
    left: 14,
    bottom: 14,
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
  handoffCard: {
    marginTop: 18,
    padding: 14,
    borderRadius: radius.xl,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.seaSoft,
  },
  handoffHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  handoffTitle: { flex: 1, fontSize: font.sizes.xl, fontWeight: font.weights.bold, color: colors.ink },
  handoffLine: { marginTop: 6, fontSize: font.sizes.lg, color: colors.ink2 },
  handoffBadge: {
    marginTop: 10,
    alignSelf: 'flex-start',
    backgroundColor: colors.seaSoft,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: radius.pill,
  },
  handoffBadgeText: { color: colors.sea, fontSize: font.sizes.sm, fontWeight: font.weights.bold },
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
  contactCard: {
    marginTop: 18,
    padding: 14,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.xl,
    backgroundColor: colors.white,
    gap: 10,
  },
  contactAddr: { fontSize: font.sizes.md, color: colors.ink2, lineHeight: 19 },
  contactActions: { flexDirection: 'row', gap: 10, flexWrap: 'wrap' },
  contactBtn: {
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.bgSoft,
  },
  contactBtnText: { fontSize: font.sizes.md, fontWeight: font.weights.bold, color: colors.ink },

  reviewBtn: {
    marginTop: 18,
    backgroundColor: colors.accent,
    padding: 14,
    borderRadius: radius.xl,
    alignItems: 'center',
  },
  reviewBtnText: { color: colors.white, fontSize: font.sizes.xl, fontWeight: font.weights.bold },

  cancelledCard: {
    marginTop: 18,
    padding: 14,
    borderRadius: radius.xl,
    backgroundColor: '#fdeeee',
    borderWidth: 1,
    borderColor: '#f3c8c8',
  },
  cancelledTitle: { fontSize: font.sizes['2xl'], fontWeight: font.weights.bold, color: colors.red },
  cancelledBody: { marginTop: 6, fontSize: font.sizes.lg, color: colors.ink2, lineHeight: 22 },

  cancelBtn: {
    marginTop: 18,
    padding: 14,
    borderRadius: radius.xl,
    borderWidth: 1.5,
    borderColor: colors.red,
    alignItems: 'center',
  },
  cancelBtnText: { color: colors.red, fontSize: font.sizes.xl, fontWeight: font.weights.bold },
  helpLink: { alignItems: 'center', paddingVertical: 14, marginTop: 4 },
  helpLinkText: { color: colors.sea, fontSize: font.sizes.lg, fontWeight: font.weights.semibold },

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
