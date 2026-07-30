import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  SectionList,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Notifications from 'expo-notifications';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useAuth } from '../src/auth';
import { useToast } from '../src/components/Toast';
import { Icon } from '../src/components/Icon';
import { LEGAL_URLS, openLegal } from '../src/legal';
import { configureNotificationHandler, registerForPush, unregisterPush } from '../src/push';
import { initChime, playNewOrderChime, releaseChime, setChimeMuted } from '../src/chime';
import {
  advanceStatus,
  getActiveOrders,
  getMyKitchen,
  isActive,
  isVisible,
  setRestaurantOpen,
  subscribeOrdersMulti,
  type KitchenBrand,
  type KitchenContext,
  type OrderStatus,
  type RestaurantOrder,
} from '../src/orders';
import { myUnreadMessageCount } from '../src/messages';
import {
  canToggleOpenAll,
  permissionDeniedMessage,
} from '../src/capabilities';
import { colors, font, radius, spacing } from '../src/theme';
import { OrderRow } from '../src/components/OrderRow';
import { KitchenHeader } from '../src/components/KitchenHeader';
import { QueueSectionHeader } from '../src/components/QueueSectionHeader';
import { notifyError, notifySuccess } from '../src/lib/haptics';
import { useLocale } from '../src/locale';
import { captureError } from '../src/lib/crash';
import { operationalErrorKey } from '../src/operationalErrors';

// [H-REST3] Live data shows merchants miss ~2/3 of orders into the 180s
// auto-accept timeout — a single missed chime = a late kitchen. Re-fire the
// chime on this cadence while any 'placed' order sits unacknowledged.
const CHIME_REPEAT_MS = 25_000;
// Persist the mute toggle so it survives a kiosk reload.
const MUTE_KEY = 'chime:muted';

export default function Home() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const { signOut } = useAuth();
  const { toast } = useToast();
  const { direction, t } = useLocale();

  const [kitchen, setKitchen] = useState<KitchenContext | null>(null);
  const [orders, setOrders] = useState<RestaurantOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [noRestaurant, setNoRestaurant] = useState(false);
  const [loadError, setLoadError] = useState(false); // [H-BIZ1] network vs no-restaurant
  const [togglingOpen, setTogglingOpen] = useState(false);
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set());
  const [unreadMsgs, setUnreadMsgs] = useState(0);
  const [muted, setMuted] = useState(false);
  // Multi-brand: which brand's tickets to show. 'all' is the default and the
  // reset target — a filter that hides a new ticket is a bug (see the
  // brand-filter reset effect below).
  const [brandFilter, setBrandFilter] = useState<'all' | string>('all');
  // Order ids whose critical-wait haptic has already fired. Owned here rather
  // than inside OrderRow because SectionList unmounts rows outside its render
  // window — a row-local ref would reset on remount and re-buzz for a ticket
  // that has merely been scrolled back into view.
  const warnedIds = useRef<Set<string>>(new Set());

  const brandIds = useMemo(
    () => (kitchen ? kitchen.brands.map((b) => b.restaurantId) : []),
    [kitchen],
  );
  const brandById = useMemo(() => {
    const map = new Map<string, KitchenBrand>();
    for (const b of kitchen?.brands ?? []) map.set(b.restaurantId, b);
    return map;
  }, [kitchen]);

  const load = useCallback(async () => {
    try {
      const k = await getMyKitchen();
      // A successful call that returns no context = genuinely not linked.
      setNoRestaurant(!k);
      setLoadError(false);
      if (!k) {
        setLoading(false);
        return;
      }
      setKitchen(k);
      const rows = await getActiveOrders(k.brands.map((b) => b.restaurantId));
      setOrders(rows);
      // Badge is advisory — a count failure must not fail the queue load.
      setUnreadMsgs(await myUnreadMessageCount().catch(() => 0));
    } catch {
      // [H-BIZ1] A transient fetch failure must NOT look like "no restaurant
      // linked". Flag a retry state and keep the last-known queue in place.
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // [H-REST1] Preload the in-app chime; release on unmount.
  useEffect(() => {
    initChime();
    return () => releaseChime();
  }, []);

  // [H-REST3] Restore the persisted mute preference on mount so a kiosk reload
  // doesn't silently un-mute (or re-mute) the counter.
  useEffect(() => {
    AsyncStorage.getItem(MUTE_KEY)
      .then((v) => {
        const on = v === '1';
        setMuted(on);
        setChimeMuted(on);
      })
      .catch(() => {});
  }, []);

  const toggleMuted = useCallback(() => {
    setMuted((prev) => {
      const next = !prev;
      setChimeMuted(next); // gates both the first chime and the repeat loop
      AsyncStorage.setItem(MUTE_KEY, next ? '1' : '0').catch(() => {});
      return next;
    });
  }, []);

  // Unread-chat badge: refresh when the screen regains focus (order screens
  // mark their thread read on open) and on a slow poll — the kiosk sits on
  // this screen and the orders Realtime channel doesn't carry message events.
  const refreshUnread = useCallback(() => {
    myUnreadMessageCount().then(setUnreadMsgs).catch(() => {});
  }, []);
  useFocusEffect(
    useCallback(() => {
      refreshUnread();
    }, [refreshUnread]),
  );
  useEffect(() => {
    const id = setInterval(refreshUnread, 60_000);
    return () => clearInterval(id);
  }, [refreshUnread]);

  // Live order updates via Realtime once we know the brands. One channel per
  // brand (postgres_changes has no `in.()` filter); a single-brand merchant
  // gets exactly one channel, same as before.
  useEffect(() => {
    if (brandIds.length === 0) return;
    const unsub = subscribeOrdersMulti(
      brandIds,
      'home',
      (row) => {
        setOrders((prev) => {
          const visible = isVisible(row) && isActive(row.status);
          if (!visible) return prev.filter((o) => o.id !== row.id);
          const exists = prev.some((o) => o.id === row.id);
          if (exists) return prev.map((o) => (o.id === row.id ? { ...o, ...row } : o));
          // [H-REST1] A newly-visible order the queue hasn't seen → sound the
          // in-app chime (independent of push, which may be denied/hiccup).
          playNewOrderChime();
          return [...prev, row].sort((a, b) => a.placed_at.localeCompare(b.placed_at));
        });
      },
      // [H-CUST2] Refetch the active list on (re)connect so orders placed during
      // a network drop — or before the channel joined — still appear.
      () => {
        getActiveOrders(brandIds)
          .then((rows) => setOrders(rows))
          .catch(() => {});
      },
    );
    return unsub;
  }, [brandIds]);

  // A filter that hides a new ticket is a bug: if an order arrives for a brand
  // that is currently filtered out, snap back to All so it cannot be missed.
  useEffect(() => {
    if (brandFilter === 'all') return;
    if (orders.some((o) => o.status === 'placed' && o.restaurant_id !== brandFilter)) {
      setBrandFilter('all');
    }
  }, [orders, brandFilter]);

  // [H-REST3] Count of unacknowledged orders — 'placed' means the kitchen hasn't
  // accepted/rejected it yet. Keyed effect below starts/stops the repeat chime.
  const placedCount = useMemo(
    () => orders.filter((o) => o.status === 'placed').length,
    [orders],
  );

  // [H-REST3] Repeat the chime every CHIME_REPEAT_MS while ≥1 order is still
  // 'placed'. One interval only (effect re-runs when the count crosses 0↔n, not
  // on every count change beyond that gate). Cleared the moment the kitchen has
  // actioned every new order, and on unmount. Mute is honoured inside
  // playNewOrderChime, so a muted kiosk sets up no interval at all.
  const hasUnacked = placedCount > 0;
  useEffect(() => {
    if (!hasUnacked || muted) return;
    const id = setInterval(playNewOrderChime, CHIME_REPEAT_MS);
    return () => clearInterval(id);
  }, [hasUnacked, muted]);

  // Push: register the tablet for new-order notifications; a tapped notification
  // refreshes the queue.
  useEffect(() => {
    configureNotificationHandler();
    registerForPush();
    const sub = Notifications.addNotificationResponseReceivedListener(
      (response: Notifications.NotificationResponse) => {
        const event = response.notification.request.content.data?.event;
        if (event === 'order_placed_merchant') load();
      },
    );
    return () => sub.remove();
  }, [load]);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  const setBusy = (id: string, on: boolean) =>
    setBusyIds((s) => {
      const next = new Set(s);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  const doAdvance = useCallback(
    async (order: RestaurantOrder, next: OrderStatus, note?: string) => {
      setBusy(order.id, true);
      try {
        await advanceStatus(order.id, next, note);
        notifySuccess();
        // Optimistic; the Realtime event will also arrive and reconcile.
        setOrders((prev) =>
          prev
            .map((o) => (o.id === order.id ? { ...o, status: next } : o))
            .filter((o) => isActive(o.status)),
        );
      } catch (e) {
        captureError(e, {
          where: 'restaurant.home.advanceOrder',
          orderId: order.id,
          nextStatus: next,
        });
        notifyError();
        toast(t(operationalErrorKey('orderUpdate')), 'error');
      } finally {
        setBusy(order.id, false);
      }
    },
    [toast, t],
  );

  // Any brand open = the kitchen is taking orders. The toggle drives ALL
  // brands at once: when the fryer dies, five storefronts must close in one
  // tap, not five. (For a single-brand merchant this is identical to before.)
  const isOpen = useMemo(
    () => (kitchen ? kitchen.brands.some((b) => b.isOpen) : false),
    [kitchen],
  );

  // Manager+ on EVERY brand this account staffs. A cloud-kitchen account can
  // hold different roles per brand, and the toggle writes all of them at once
  // (mig 136 gates restaurants.is_open on is_merchant_manager). Requiring
  // manager+ across the board keeps Promise.all from half-succeeding.
  const mayToggleOpen = useMemo(
    () => canToggleOpenAll((kitchen?.brands ?? []).map((b) => b.staffRole)),
    [kitchen],
  );

  const toggleOpen = useCallback(async () => {
    if (!kitchen || togglingOpen) return;
    if (!mayToggleOpen) {
      notifyError();
      toast(t('home.permissionDenied'), 'error');
      return;
    }
    setTogglingOpen(true);
    const next = !isOpen;
    // Optimistic: flip every brand locally.
    const prevKitchen = kitchen;
    setKitchen({
      ...kitchen,
      brands: kitchen.brands.map((b) => ({ ...b, isOpen: next })),
    });
    // [P06 Stage 3] allSettled, not all: the spec requires a VISIBLE per-brand
    // result. Promise.all failed fast — some brand writes had already landed,
    // some never ran, and the operator learned only "could not update", not
    // WHICH storefronts were still taking orders with a dead fryer.
    const targets = prevKitchen.brands.filter((b) => b.isOpen !== next);
    try {
      const results = await Promise.allSettled(
        targets.map((b) => setRestaurantOpen(b.restaurantId, next)),
      );
      const failed = results
        .map((r, i) => (r.status === 'rejected' ? { brand: targets[i], reason: r.reason } : null))
        .filter((f): f is { brand: (typeof targets)[number]; reason: unknown } => f !== null);
      if (failed.length > 0) {
        // Name every brand that did NOT flip, with the first failure's cause
        // (an RLS denial reads as "manager required", not a raw error).
        notifyError();
        for (const failure of failed) {
          captureError(failure.reason, {
            where: 'restaurant.home.toggleOpen',
            restaurantId: failure.brand.restaurantId,
            intendedOpen: next,
          });
        }
        const names = failed.map((f) => f.brand.name).join(', ');
        const permissionDenied = permissionDeniedMessage(failed[0].reason) !== null;
        const cause = permissionDenied
          ? t('home.permissionDenied')
          : t(operationalErrorKey('brandToggle'));
        toast(
          t('home.brandUpdatePartial', {
            updated: targets.length - failed.length,
            total: targets.length,
            state: next ? t('home.brandStateClosed') : t('home.brandStateOpen'),
            brands: names,
            cause,
          }),
          'error',
        );
        // The optimistic flip is wrong for the failed brands; re-sync rather
        // than guessing which writes landed.
        await load();
      }
    } finally {
      setTogglingOpen(false);
    }
  }, [kitchen, isOpen, togglingOpen, toast, load, mayToggleOpen, t]);

  const handleSignOut = useCallback(async () => {
    await unregisterPush();
    await signOut();
    router.replace('/signin');
  }, [signOut, router]);

  // The brand filter FILTERS the one list; it never replaces it with per-brand
  // tabs. A ticket in an unselected tab is an invisible ticket.
  const visibleOrders = useMemo(
    () => (brandFilter === 'all' ? orders : orders.filter((o) => o.restaurant_id === brandFilter)),
    [orders, brandFilter],
  );
  const incoming = useMemo(
    () => visibleOrders.filter((o) => o.status === 'placed'),
    [visibleOrders],
  );
  const inKitchen = useMemo(
    () => visibleOrders.filter((o) => o.status === 'accepted' || o.status === 'preparing'),
    [visibleOrders],
  );
  const ready = useMemo(
    () => visibleOrders.filter((o) => ['ready', 'picked_up', 'out_for_delivery'].includes(o.status)),
    [visibleOrders],
  );
  const compactHeader = width < 560;
  const queueSections = useMemo(
    () =>
      [
        { key: 'new' as const, title: t('queue.new'), accent: true, data: incoming },
        { key: 'kitchen' as const, title: t('queue.inKitchen'), accent: false, data: inKitchen },
        { key: 'ready' as const, title: t('queue.ready'), accent: false, data: ready },
      ].filter((section) => section.data.length > 0),
    [incoming, inKitchen, ready, t],
  );

  if (loading) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg }}>
        <ActivityIndicator color={colors.accent} size="large" />
      </View>
    );
  }

  // [H-BIZ1] A fetch failed (network) — retry, don't show "not linked".
  if (loadError && !kitchen) {
    return (
      <View style={[homeStyles.centeredState, { direction }]}>
        <Text style={{ fontSize: font.sizes.xl, fontWeight: '700', color: colors.ink, textAlign: 'center' }}>
          {t('home.loadErrorTitle')}
        </Text>
        <Text style={{ color: colors.ink2, textAlign: 'center' }}>
          {t('home.loadErrorBody')}
        </Text>
        <Pressable
          onPress={() => {
            setLoading(true);
            load();
          }}
          accessibilityRole="button"
          accessibilityLabel={t('home.retryA11y')}
          style={{
            marginTop: spacing.lg,
            minHeight: 48,
            justifyContent: 'center',
            backgroundColor: colors.accent,
            borderRadius: radius.lg,
            borderCurve: 'continuous',
            paddingHorizontal: spacing.xl,
          }}
        >
          <Text style={{ color: colors.white, fontWeight: '700' }}>{t('home.retry')}</Text>
        </Pressable>
        <Pressable onPress={handleSignOut} accessibilityRole="button" style={homeStyles.textButton}>
          <Text style={{ color: colors.ink3, fontWeight: '700' }}>{t('home.signOut')}</Text>
        </Pressable>
      </View>
    );
  }

  if (noRestaurant) {
    return (
      <View style={[homeStyles.centeredState, { direction }]}>
        <Text style={{ fontSize: font.sizes.xl, fontWeight: '700', color: colors.ink, textAlign: 'center' }}>
          {t('home.noRestaurantTitle')}
        </Text>
        <Text style={{ color: colors.ink2, textAlign: 'center' }}>
          {t('home.noRestaurantBody')}
        </Text>
        <Pressable onPress={handleSignOut} accessibilityRole="button" style={homeStyles.textButton}>
          <Text style={{ color: colors.accent, fontWeight: '700' }}>{t('home.signOut')}</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg, direction }}>
      {kitchen && (
        <KitchenHeader
          kitchen={kitchen}
          isOpen={isOpen}
          mayToggleOpen={mayToggleOpen}
          togglingOpen={togglingOpen}
          onToggleOpen={toggleOpen}
          muted={muted}
          onToggleMuted={toggleMuted}
          unreadMsgs={unreadMsgs}
          orders={orders}
          brandFilter={brandFilter}
          onBrandFilter={setBrandFilter}
          compact={compactHeader}
          onNavigate={(path) => router.push(path)}
        />
      )}

      <SectionList
        sections={queueSections}
        keyExtractor={(item) => item.id}
        contentInsetAdjustmentBehavior="automatic"
        stickySectionHeadersEnabled={false}
        initialNumToRender={8}
        maxToRenderPerBatch={8}
        windowSize={7}
        contentContainerStyle={{
          padding: spacing.lg,
          paddingBottom: insets.bottom + spacing.xxl,
          flexGrow: orders.length === 0 ? 1 : undefined,
        }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.accent} />}
        renderSectionHeader={({ section }) => (
          <QueueSectionHeader title={section.title} count={section.data.length} accent={section.accent} />
        )}
        renderItem={({ item, section }) => {
          // Brand identity rides on the ticket, not the container. Only tag in
          // multi-brand kitchens — a single-brand merchant sees no chip.
          const brandTag = kitchen?.isMultiBrand
            ? brandById.get(item.restaurant_id)?.shortName
            : undefined;
          return (
            <View style={homeStyles.orderItem}>
              {section.key === 'new' ? (
                <OrderRow
                  order={item}
                  busy={busyIds.has(item.id)}
                  brandTag={brandTag}
                  muted={muted}
                  warnedIds={warnedIds.current}
                  onOpenDetail={() => router.push(`/order/${item.id}`)}
                  onAccept={() => doAdvance(item, 'accepted')}
                  onReject={(reason) => doAdvance(item, 'rejected', reason)}
                />
              ) : section.key === 'kitchen' ? (
                <OrderRow
                  order={item}
                  busy={busyIds.has(item.id)}
                  brandTag={brandTag}
                  muted={muted}
                  warnedIds={warnedIds.current}
                  onOpenDetail={() => router.push(`/order/${item.id}`)}
                  primary={
                    item.status === 'accepted'
                      ? { label: t('queue.startPreparing'), next: 'preparing' }
                      : { label: t('queue.markReady'), next: 'ready' }
                  }
                  onPrimary={(next) => doAdvance(item, next)}
                />
              ) : (
                <OrderRow
                  order={item}
                  busy={busyIds.has(item.id)}
                  brandTag={brandTag}
                  muted={muted}
                  warnedIds={warnedIds.current}
                  onOpenDetail={() => router.push(`/order/${item.id}`)}
                />
              )}
            </View>
          );
        }}
        ListEmptyComponent={
          <View style={homeStyles.emptyQueue}>
            <Icon name="bell" size={40} color={colors.ink3} accessibilityLabel={t('queue.noOrdersA11y')} />
            <Text style={{ fontSize: font.sizes.lg, fontWeight: '700', color: colors.ink }}>
              {t('queue.emptyTitle')}
            </Text>
            <Text style={{ fontSize: font.sizes.sm, color: colors.ink2, textAlign: 'center' }}>
              {t('queue.emptyBody')}
            </Text>
          </View>
        }
        ListFooterComponent={
          <View style={homeStyles.legal}>
            <Text
              style={{
                fontSize: font.sizes.sm,
                fontWeight: '700',
                color: colors.ink2,
                textTransform: direction === 'rtl' ? 'none' : 'uppercase',
                letterSpacing: direction === 'rtl' ? 0 : 0.6,
                marginBottom: spacing.sm,
              }}
            >
              {t('home.legal')}
            </Text>
            <Pressable
              onPress={() => openLegal(LEGAL_URLS.terms)}
              accessibilityRole="link"
              accessibilityLabel={t('home.terms')}
              style={homeStyles.legalRow}
            >
              <Text style={{ flex: 1, color: colors.ink, fontSize: font.sizes.lg, fontWeight: '600' }}>
                {t('home.terms')}
              </Text>
              <Icon name="chevronForward" size={16} color={colors.ink3} />
            </Pressable>
            <View style={{ height: 1, backgroundColor: colors.line }} />
            <Pressable
              onPress={() => openLegal(LEGAL_URLS.privacy)}
              accessibilityRole="link"
              accessibilityLabel={t('home.privacy')}
              style={homeStyles.legalRow}
            >
              <Text style={{ flex: 1, color: colors.ink, fontSize: font.sizes.lg, fontWeight: '600' }}>
                {t('home.privacy')}
              </Text>
              <Icon name="chevronForward" size={16} color={colors.ink3} />
            </Pressable>
            <Pressable
              onPress={handleSignOut}
              accessibilityRole="button"
              accessibilityLabel={t('home.signOut')}
              style={{ marginTop: spacing.xl, minHeight: 48, alignItems: 'center', justifyContent: 'center' }}
            >
              <Text style={{ color: colors.ink3, fontSize: font.sizes.base, fontWeight: '600' }}>
                {t('home.signOut')}
              </Text>
            </Pressable>
          </View>
        }
      />
    </View>
  );
}

const homeStyles = StyleSheet.create({
  centeredState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xxl,
    backgroundColor: colors.bg,
    gap: spacing.md,
  },
  textButton: {
    minHeight: 48,
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
  },
  orderItem: {
    width: '100%',
    maxWidth: 840,
    alignSelf: 'center',
    marginBottom: spacing.md,
  },
  emptyQueue: {
    width: '100%',
    maxWidth: 520,
    minHeight: 220,
    alignSelf: 'center',
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
    paddingVertical: spacing.xxxl,
  },
  legal: {
    width: '100%',
    maxWidth: 840,
    alignSelf: 'center',
    marginTop: spacing.xxl,
  },
  legalRow: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 48,
  },
});
