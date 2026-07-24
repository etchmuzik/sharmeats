import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  SectionList,
  StyleSheet,
  Text,
  TextInput,
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
import { AllergenBanner } from '../src/components/AllergenBanner';
import { ContactButtons } from '../src/components/ContactButtons';
import { configureNotificationHandler, registerForPush, unregisterPush } from '../src/push';
import { initChime, playNewOrderChime, releaseChime, setChimeMuted } from '../src/chime';
import {
  advanceStatus,
  getActiveOrders,
  getMyRestaurant,
  isActive,
  isVisible,
  setRestaurantOpen,
  subscribeOrders,
  type OrderStatus,
  type RestaurantContext,
  type RestaurantOrder,
} from '../src/orders';
import { myUnreadMessageCount } from '../src/messages';
import { colors, font, radius, spacing } from '../src/theme';

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

  const [ctx, setCtx] = useState<RestaurantContext | null>(null);
  const [orders, setOrders] = useState<RestaurantOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [noRestaurant, setNoRestaurant] = useState(false);
  const [loadError, setLoadError] = useState(false); // [H-BIZ1] network vs no-restaurant
  const [isOpen, setIsOpen] = useState(false);
  const [togglingOpen, setTogglingOpen] = useState(false);
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set());
  const [unreadMsgs, setUnreadMsgs] = useState(0);
  const [muted, setMuted] = useState(false);

  const load = useCallback(async () => {
    try {
      const c = await getMyRestaurant();
      // A successful call that returns no context = genuinely not linked.
      setNoRestaurant(!c);
      setLoadError(false);
      if (!c) {
        setLoading(false);
        return;
      }
      setCtx(c);
      setIsOpen(c.isOpen);
      const rows = await getActiveOrders(c.restaurantId);
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

  // Live order updates via Realtime once we know the restaurant.
  useEffect(() => {
    if (!ctx) return;
    const unsub = subscribeOrders(
      ctx.restaurantId,
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
        getActiveOrders(ctx.restaurantId)
          .then((rows) => setOrders(rows))
          .catch(() => {});
      },
    );
    return unsub;
  }, [ctx]);

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
        // Optimistic; the Realtime event will also arrive and reconcile.
        setOrders((prev) =>
          prev
            .map((o) => (o.id === order.id ? { ...o, status: next } : o))
            .filter((o) => isActive(o.status)),
        );
      } catch (e) {
        toast(e instanceof Error ? e.message : 'Could not update order', 'error');
      } finally {
        setBusy(order.id, false);
      }
    },
    [toast],
  );

  const toggleOpen = useCallback(async () => {
    if (!ctx || togglingOpen) return;
    setTogglingOpen(true);
    const next = !isOpen;
    setIsOpen(next);
    try {
      await setRestaurantOpen(ctx.restaurantId, next);
    } catch (e) {
      setIsOpen(!next);
      toast(e instanceof Error ? e.message : 'Could not update status', 'error');
    } finally {
      setTogglingOpen(false);
    }
  }, [ctx, isOpen, togglingOpen, toast]);

  const handleSignOut = useCallback(async () => {
    await unregisterPush();
    await signOut();
    router.replace('/signin');
  }, [signOut, router]);

  const incoming = useMemo(() => orders.filter((o) => o.status === 'placed'), [orders]);
  const inKitchen = useMemo(
    () => orders.filter((o) => o.status === 'accepted' || o.status === 'preparing'),
    [orders],
  );
  const ready = useMemo(
    () => orders.filter((o) => ['ready', 'picked_up', 'out_for_delivery'].includes(o.status)),
    [orders],
  );
  const compactHeader = width < 560;
  const queueSections = useMemo(
    () =>
      [
        { key: 'new' as const, title: 'New', accent: true, data: incoming },
        { key: 'kitchen' as const, title: 'In kitchen', accent: false, data: inKitchen },
        { key: 'ready' as const, title: 'Ready / picked up', accent: false, data: ready },
      ].filter((section) => section.data.length > 0),
    [incoming, inKitchen, ready],
  );

  if (loading) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg }}>
        <ActivityIndicator color={colors.accent} size="large" />
      </View>
    );
  }

  // [H-BIZ1] A fetch failed (network) — retry, don't show "not linked".
  if (loadError && !ctx) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xxl, backgroundColor: colors.bg, gap: spacing.md }}>
        <Text style={{ fontSize: font.sizes.xl, fontWeight: '700', color: colors.ink, textAlign: 'center' }}>
          Couldn&apos;t load your restaurant
        </Text>
        <Text style={{ color: colors.ink2, textAlign: 'center' }}>
          Check your connection and try again.
        </Text>
        <Pressable
          onPress={() => {
            setLoading(true);
            load();
          }}
          style={{ marginTop: spacing.lg, backgroundColor: colors.accent, borderRadius: radius.lg, paddingVertical: spacing.md, paddingHorizontal: spacing.xl }}
        >
          <Text style={{ color: colors.white, fontWeight: '700' }}>Retry</Text>
        </Pressable>
        <Pressable onPress={handleSignOut} style={{ padding: spacing.md }}>
          <Text style={{ color: colors.ink3, fontWeight: '700' }}>Sign out</Text>
        </Pressable>
      </View>
    );
  }

  if (noRestaurant) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xxl, backgroundColor: colors.bg, gap: spacing.md }}>
        <Text style={{ fontSize: font.sizes.xl, fontWeight: '700', color: colors.ink, textAlign: 'center' }}>
          No restaurant linked
        </Text>
        <Text style={{ color: colors.ink2, textAlign: 'center' }}>
          This account isn&apos;t linked to a restaurant yet. Ask the Sharm Eats team to add you as staff.
        </Text>
        <Pressable onPress={handleSignOut} style={{ marginTop: spacing.lg, padding: spacing.md }}>
          <Text style={{ color: colors.accent, fontWeight: '700' }}>Sign out</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      {/* Header */}
      <View style={[homeStyles.header, { paddingTop: insets.top + spacing.sm }]}>
        <View style={homeStyles.headerTop}>
          <View style={homeStyles.restaurantIdentity}>
            <Text style={homeStyles.restaurantName} numberOfLines={2}>
              {ctx?.restaurantName}
            </Text>
            <Text style={homeStyles.restaurantRole}>Restaurant · {ctx?.staffRole}</Text>
          </View>
          {unreadMsgs > 0 && (
            <View
              accessibilityLabel={`${unreadMsgs} unread customer messages. Open an order to reply.`}
              style={homeStyles.unreadBadge}
            >
              <Icon name="chat" size={16} color={colors.accentDark} />
              <Text style={homeStyles.unreadText}>{unreadMsgs}</Text>
            </View>
          )}
          <Pressable
            onPress={handleSignOut}
            accessibilityRole="button"
            accessibilityLabel="Sign out"
            hitSlop={8}
            style={homeStyles.signOutButton}
          >
            <Icon name="signout" size={22} color={colors.ink2} />
          </Pressable>
        </View>

        <View style={homeStyles.headerActions}>
        <Pressable
          onPress={toggleOpen}
          disabled={togglingOpen}
          accessibilityRole="switch"
          accessibilityLabel="Restaurant accepting orders"
          accessibilityState={{ checked: isOpen, disabled: togglingOpen, busy: togglingOpen }}
          style={[
            homeStyles.statusControl,
            { backgroundColor: isOpen ? colors.greenSoft : colors.redSoft },
            compactHeader && homeStyles.compactStatusControl,
          ]}
        >
          <Text style={{ fontSize: font.sizes.sm, fontWeight: '700', color: isOpen ? colors.green : colors.red }}>
            {togglingOpen ? '…' : isOpen ? 'Open · pause' : 'Closed · open'}
          </Text>
        </Pressable>
        {/* [H-REST3] Mute the new-order chime (and its repeat). Distinct muted
            state so staff can see at a glance the counter is silent. */}
        <Pressable
          onPress={toggleMuted}
          accessibilityRole="switch"
          accessibilityState={{ checked: muted }}
          accessibilityLabel={muted ? 'Sound off — tap to turn new-order chime on' : 'Sound on — tap to mute new-order chime'}
          style={[
            homeStyles.statusControl,
            { backgroundColor: muted ? colors.redSoft : colors.greenSoft },
            compactHeader && homeStyles.compactStatusControl,
          ]}
        >
          <Icon name={muted ? 'mute' : 'sound'} size={14} color={muted ? colors.red : colors.green} />
          <Text style={{ fontSize: font.sizes.sm, fontWeight: '700', color: muted ? colors.red : colors.green }}>
            {muted ? 'Muted' : 'Sound'}
          </Text>
        </Pressable>
        <Pressable
          onPress={() => router.push('/menu')}
          accessibilityRole="button"
          accessibilityLabel="Menu availability"
          style={[homeStyles.navControl, compactHeader && homeStyles.compactNavControl]}
        >
          <Text style={{ fontSize: font.sizes.sm, fontWeight: '700', color: colors.accent }}>Menu</Text>
        </Pressable>
        <Pressable
          onPress={() => router.push('/kyc')}
          accessibilityRole="button"
          accessibilityLabel="Verification documents"
          style={[homeStyles.navControl, compactHeader && homeStyles.compactNavControl]}
        >
          <Text style={{ fontSize: font.sizes.sm, fontWeight: '700', color: colors.accent }}>Docs</Text>
        </Pressable>
        <Pressable
          onPress={() => router.push('/tier')}
          accessibilityRole="button"
          accessibilityLabel="View tier status"
          style={[homeStyles.navControl, compactHeader && homeStyles.compactNavControl]}
        >
          <Text style={{ fontSize: font.sizes.sm, fontWeight: '700', color: colors.accent }}>Tier</Text>
        </Pressable>
        </View>
      </View>

      <SectionList
        sections={queueSections}
        keyExtractor={(item) => item.id}
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
        renderItem={({ item, section }) => (
          <View style={homeStyles.orderItem}>
            {section.key === 'new' ? (
              <OrderRow
                order={item}
                busy={busyIds.has(item.id)}
                onOpenDetail={() => router.push(`/order/${item.id}`)}
                onAccept={() => doAdvance(item, 'accepted')}
                onReject={(reason) => doAdvance(item, 'rejected', reason)}
              />
            ) : section.key === 'kitchen' ? (
              <OrderRow
                order={item}
                busy={busyIds.has(item.id)}
                onOpenDetail={() => router.push(`/order/${item.id}`)}
                primary={
                  item.status === 'accepted'
                    ? { label: 'Start preparing', next: 'preparing' }
                    : { label: 'Mark ready', next: 'ready' }
                }
                onPrimary={(next) => doAdvance(item, next)}
              />
            ) : (
              <OrderRow
                order={item}
                busy={busyIds.has(item.id)}
                onOpenDetail={() => router.push(`/order/${item.id}`)}
              />
            )}
          </View>
        )}
        ListEmptyComponent={
          <View style={homeStyles.emptyQueue}>
            <Icon name="bell" size={40} color={colors.ink3} accessibilityLabel="No orders" />
            <Text style={{ fontSize: font.sizes.lg, fontWeight: '700', color: colors.ink }}>Waiting for orders</Text>
            <Text style={{ fontSize: font.sizes.sm, color: colors.ink2, textAlign: 'center' }}>
              New orders appear here instantly with a sound alert.
            </Text>
          </View>
        }
        ListFooterComponent={
          <View style={homeStyles.legal}>
          <Text style={{ fontSize: font.sizes.sm, fontWeight: '700', color: colors.ink2, textTransform: 'uppercase', marginBottom: spacing.sm }}>
            Legal
          </Text>
          <Pressable
            onPress={() => openLegal(LEGAL_URLS.terms)}
            accessibilityRole="link"
            accessibilityLabel="Terms of Service"
            style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.md }}
          >
            <Text style={{ flex: 1, color: colors.ink, fontSize: font.sizes.lg, fontWeight: '600' }}>Terms of Service</Text>
            <Icon name="chevronForward" size={16} color={colors.ink3} />
          </Pressable>
          <View style={{ height: 1, backgroundColor: colors.line }} />
          <Pressable
            onPress={() => openLegal(LEGAL_URLS.privacy)}
            accessibilityRole="link"
            accessibilityLabel="Privacy Policy"
            style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.md }}
          >
            <Text style={{ flex: 1, color: colors.ink, fontSize: font.sizes.lg, fontWeight: '600' }}>Privacy Policy</Text>
            <Icon name="chevronForward" size={16} color={colors.ink3} />
          </Pressable>
          </View>
        }
      />
    </View>
  );
}

// ── Section ──────────────────────────────────────────────────────────────────
function QueueSectionHeader({
  title,
  count,
  accent,
}: {
  title: string;
  count: number;
  accent?: boolean;
}) {
  return (
    <View style={homeStyles.sectionHeader}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
        <Text style={{ fontSize: font.sizes.sm, fontWeight: '800', letterSpacing: 1, textTransform: 'uppercase', color: accent ? colors.accent : colors.ink2 }}>
          {title}
        </Text>
        <View style={{ minWidth: 22, alignItems: 'center', borderRadius: radius.pill, backgroundColor: accent ? colors.accentSoft : colors.sand, paddingHorizontal: 8, paddingVertical: 2 }}>
          <Text style={{ fontSize: font.sizes.xs, fontWeight: '700', color: accent ? colors.accentDark : colors.ink2 }}>{count}</Text>
        </View>
      </View>
    </View>
  );
}

// ── Order row (card) ─────────────────────────────────────────────────────────
function OrderRow({
  order,
  busy,
  onOpenDetail,
  onAccept,
  onReject,
  primary,
  onPrimary,
}: {
  order: RestaurantOrder;
  busy: boolean;
  onOpenDetail?: () => void;
  onAccept?: () => void;
  onReject?: (reason?: string) => void;
  primary?: { label: string; next: OrderStatus };
  onPrimary?: (next: OrderStatus) => void;
}) {
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');
  const addr = order.address_snapshot;
  const addrLine =
    addr?.kind === 'hotel'
      ? `${addr.hotelName ?? 'Hotel'} · Room ${addr.roomNumber ?? 'not provided'}`
      : addr?.kind === 'street'
        ? `${addr.streetText ?? ''} ${addr.building ?? ''}`.trim() || 'Address'
        : addr?.kind === 'beach_pin'
          ? `Beach · ${addr.beachName ?? ''}`
          : (addr?.label ?? 'Address');

  return (
    <View style={{ borderWidth: 1, borderColor: colors.line, borderRadius: radius.xl, backgroundColor: colors.white, padding: spacing.lg, gap: spacing.sm }}>
      <Pressable
        onPress={onOpenDetail}
        disabled={!onOpenDetail}
        accessibilityRole={onOpenDetail ? 'button' : undefined}
        accessibilityLabel={onOpenDetail ? `Open order ${order.short_code}` : undefined}
        style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <View>
            <Text style={{ fontWeight: '800', fontSize: font.sizes.lg, color: colors.ink }}>{order.short_code}</Text>
            <Text style={{ fontSize: font.sizes.xs, color: colors.ink3 }}>
              {new Date(order.placed_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              {order.scheduled_for
                ? ` · scheduled ${new Date(order.scheduled_for).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
                : ''}
            </Text>
          </View>
          {onOpenDetail ? <Icon name="chevronForward" size={16} color={colors.ink3} /> : null}
        </View>
        <View style={{ alignItems: 'flex-end' }}>
          <Text style={{ fontWeight: '800', fontSize: font.sizes.lg, color: colors.ink }}>{order.total_egp} EGP</Text>
          <Text style={{ fontSize: font.sizes.xs, fontWeight: '700', color: order.payment_method === 'cash_on_delivery' ? colors.sea : order.payment_status === 'paid' ? colors.green : colors.amber }}>
            {order.payment_method === 'cash_on_delivery' ? 'Cash on delivery' : `Card · ${order.payment_status}`}
          </Text>
        </View>
      </Pressable>

      {/* [H-REST2] Food-safety allergy briefing — must be prominent. */}
      <AllergenBanner allergens={order.aggregate_allergens} />

      {/* Items */}
      <View style={{ gap: 2 }}>
        {order.items?.map((it, i) => (
          <View key={i}>
            <Text style={{ fontSize: font.sizes.base, color: colors.ink }}>
              <Text style={{ fontWeight: '700' }}>{it.quantity}× </Text>
              {it.name}
              {it.modifierChoices && it.modifierChoices.length > 0 ? (
                <Text style={{ color: colors.ink3 }}>
                  {' '}
                  ({it.modifierChoices.map((m) => m.optionName).filter(Boolean).join(', ')})
                </Text>
              ) : null}
            </Text>
            {/* [H-REST1] Per-item note (e.g. "no onions") — the kitchen must see
                this. Previously only merchant-web rendered it. */}
            {it.notes ? (
              <Text style={{ fontSize: font.sizes.sm, color: colors.amber, marginLeft: spacing.md }}>
                “{it.notes}”
              </Text>
            ) : null}
          </View>
        ))}
      </View>

      {order.kitchen_notes ? (
        <View style={{ backgroundColor: colors.amberSoft, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm }}>
          <Text style={{ fontSize: font.sizes.xs, color: colors.amber }}>Kitchen note: {order.kitchen_notes}</Text>
        </View>
      ) : null}

      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, borderTopWidth: 1, borderTopColor: colors.line, paddingTop: spacing.sm }}>
        <Icon name="location" size={13} color={colors.ink3} />
        <Text style={{ flex: 1, flexShrink: 1, fontSize: font.sizes.xs, color: colors.ink2 }}>{addrLine}</Text>
        <View style={{ borderRadius: radius.sm, backgroundColor: colors.sand, paddingHorizontal: 6, paddingVertical: 2 }}>
          <Text style={{ fontSize: font.sizes.xs, textTransform: 'uppercase', color: colors.ink2 }}>
            {order.fulfillment_type === 'self_delivery' ? 'self-delivery' : 'platform fleet'}
          </Text>
        </View>
      </View>

      {/* [H-REST2] Contact — call the customer or open the in-app chat. */}
      <ContactButtons orderId={order.id} customerPhone={order.customer_phone} />

      {/* Actions */}
      {rejecting && onReject ? (
        <View style={{ borderWidth: 1, borderColor: colors.red, backgroundColor: colors.redSoft, borderRadius: radius.lg, padding: spacing.md, gap: spacing.sm }}>
          <Text style={{ fontSize: font.sizes.xs, fontWeight: '700', color: colors.red }}>Reason for rejecting (optional)</Text>
          <TextInput
            autoFocus
            value={reason}
            onChangeText={setReason}
            placeholder="e.g. out of stock, kitchen closing"
            placeholderTextColor={colors.ink3}
            accessibilityLabel="Reason for rejecting"
            style={{ borderWidth: 1, borderColor: colors.line, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, backgroundColor: colors.white, color: colors.ink }}
          />
          <View style={{ flexDirection: 'row', gap: spacing.sm }}>
            <Pressable
              onPress={() => { setRejecting(false); setReason(''); }}
              accessibilityRole="button"
              accessibilityLabel="Cancel rejection"
              style={{ flex: 1, minHeight: 48, borderWidth: 1, borderColor: colors.line, borderRadius: radius.md, paddingVertical: spacing.md, alignItems: 'center', justifyContent: 'center' }}
            >
              <Text style={{ fontSize: font.sizes.sm, fontWeight: '700', color: colors.ink2 }}>Cancel</Text>
            </Pressable>
            <Pressable
              onPress={() => onReject(reason.trim() || undefined)}
              accessibilityRole="button"
              accessibilityLabel="Confirm rejection"
              style={{ flex: 1, minHeight: 48, backgroundColor: colors.red, borderRadius: radius.md, paddingVertical: spacing.md, alignItems: 'center', justifyContent: 'center' }}
            >
              <Text style={{ fontSize: font.sizes.sm, fontWeight: '700', color: colors.white }}>Confirm reject</Text>
            </Pressable>
          </View>
        </View>
      ) : (onAccept || onReject || primary) ? (
        <View style={{ flexDirection: 'row', gap: spacing.sm }}>
          {onReject && (
            <Pressable
              onPress={() => setRejecting(true)}
              disabled={busy}
              accessibilityRole="button"
              accessibilityLabel={`Reject order ${order.short_code}`}
              accessibilityState={{ disabled: busy, busy }}
              style={{ flex: 1, minHeight: 48, borderWidth: 1, borderColor: colors.line, borderRadius: radius.lg, paddingVertical: spacing.md, alignItems: 'center', justifyContent: 'center', opacity: busy ? 0.5 : 1 }}
            >
              <Text style={{ fontSize: font.sizes.base, fontWeight: '700', color: colors.red }}>Reject</Text>
            </Pressable>
          )}
          {onAccept && (
            <Pressable
              onPress={onAccept}
              disabled={busy}
              accessibilityRole="button"
              accessibilityLabel={`Accept order ${order.short_code}`}
              accessibilityState={{ disabled: busy, busy }}
              style={{ flex: 1, minHeight: 48, backgroundColor: colors.green, borderRadius: radius.lg, paddingVertical: spacing.md, alignItems: 'center', justifyContent: 'center', opacity: busy ? 0.6 : 1 }}
            >
              {busy ? <ActivityIndicator color={colors.white} /> : <Text style={{ fontSize: font.sizes.base, fontWeight: '700', color: colors.white }}>Accept</Text>}
            </Pressable>
          )}
          {primary && onPrimary && (
            <Pressable
              onPress={() => onPrimary(primary.next)}
              disabled={busy}
              accessibilityRole="button"
              accessibilityLabel={`${primary.label} for order ${order.short_code}`}
              accessibilityState={{ disabled: busy, busy }}
              style={{ flex: 1, minHeight: 48, backgroundColor: colors.accent, borderRadius: radius.lg, paddingVertical: spacing.md, alignItems: 'center', justifyContent: 'center', opacity: busy ? 0.6 : 1 }}
            >
              {busy ? <ActivityIndicator color={colors.white} /> : <Text style={{ fontSize: font.sizes.base, fontWeight: '700', color: colors.white }}>{primary.label}</Text>}
            </Pressable>
          )}
        </View>
      ) : null}
    </View>
  );
}

const homeStyles = StyleSheet.create({
  header: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
    backgroundColor: colors.white,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
    gap: spacing.sm,
  },
  headerTop: {
    width: '100%',
    maxWidth: 840,
    alignSelf: 'center',
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  restaurantIdentity: { flex: 1, minWidth: 0 },
  restaurantName: { fontSize: font.sizes.xl, fontWeight: '800', color: colors.ink },
  restaurantRole: { marginTop: 2, fontSize: font.sizes.xs, color: colors.ink3 },
  unreadBadge: {
    minWidth: 44,
    minHeight: 44,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.pill,
    backgroundColor: colors.accentSoft,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  unreadText: { fontSize: font.sizes.sm, fontWeight: '800', color: colors.accentDark },
  signOutButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.bgSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerActions: {
    width: '100%',
    maxWidth: 840,
    alignSelf: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: spacing.sm,
  },
  statusControl: {
    minHeight: 44,
    paddingHorizontal: spacing.md,
    borderRadius: radius.pill,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
  },
  compactStatusControl: { flexGrow: 1, flexBasis: '46%' },
  navControl: {
    minHeight: 44,
    paddingHorizontal: spacing.md,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.bgSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  compactNavControl: { flexGrow: 1, flexBasis: '28%' },
  sectionHeader: {
    width: '100%',
    maxWidth: 840,
    alignSelf: 'center',
    paddingTop: spacing.lg,
    paddingBottom: spacing.sm,
    backgroundColor: colors.bg,
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
});
