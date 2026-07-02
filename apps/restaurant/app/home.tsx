import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Notifications from 'expo-notifications';
import { useAuth } from '../src/auth';
import { useToast } from '../src/components/Toast';
import { Icon } from '../src/components/Icon';
import { configureNotificationHandler, registerForPush, unregisterPush } from '../src/push';
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
import { colors, font, radius, spacing } from '../src/theme';

export default function Home() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { signOut } = useAuth();
  const { toast } = useToast();

  const [ctx, setCtx] = useState<RestaurantContext | null>(null);
  const [orders, setOrders] = useState<RestaurantOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [noRestaurant, setNoRestaurant] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const [togglingOpen, setTogglingOpen] = useState(false);
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    try {
      const c = await getMyRestaurant();
      if (!c) {
        setNoRestaurant(true);
        setLoading(false);
        return;
      }
      setCtx(c);
      setIsOpen(c.isOpen);
      const rows = await getActiveOrders(c.restaurantId);
      setOrders(rows);
    } catch {
      // best-effort; a transient error leaves the last-known queue in place
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Live order updates via Realtime once we know the restaurant.
  useEffect(() => {
    if (!ctx) return;
    const unsub = subscribeOrders(ctx.restaurantId, (row) => {
      setOrders((prev) => {
        const visible = isVisible(row) && isActive(row.status);
        if (!visible) return prev.filter((o) => o.id !== row.id);
        const exists = prev.some((o) => o.id === row.id);
        if (exists) return prev.map((o) => (o.id === row.id ? { ...o, ...row } : o));
        return [...prev, row].sort((a, b) => a.placed_at.localeCompare(b.placed_at));
      });
    });
    return unsub;
  }, [ctx]);

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

  if (loading) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg }}>
        <ActivityIndicator color={colors.accent} size="large" />
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
      <View
        style={{
          paddingTop: insets.top + spacing.md,
          paddingHorizontal: spacing.lg,
          paddingBottom: spacing.md,
          backgroundColor: colors.white,
          borderBottomWidth: 1,
          borderBottomColor: colors.line,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: font.sizes.xl, fontWeight: '800', color: colors.ink }} numberOfLines={1}>
            {ctx?.restaurantName}
          </Text>
          <Text style={{ fontSize: font.sizes.xs, color: colors.ink3 }}>
            Restaurant · {ctx?.staffRole}
          </Text>
        </View>
        <Pressable
          onPress={toggleOpen}
          disabled={togglingOpen}
          accessibilityRole="button"
          style={{
            paddingHorizontal: spacing.md,
            paddingVertical: spacing.sm,
            borderRadius: radius.pill,
            backgroundColor: isOpen ? colors.greenSoft : colors.redSoft,
            marginRight: spacing.sm,
          }}
        >
          <Text style={{ fontSize: font.sizes.sm, fontWeight: '700', color: isOpen ? colors.green : colors.red }}>
            {togglingOpen ? '…' : isOpen ? 'Open · pause' : 'Closed · open'}
          </Text>
        </Pressable>
        <Pressable
          onPress={() => router.push('/tier')}
          accessibilityRole="button"
          accessibilityLabel="View tier status"
          style={{ paddingHorizontal: spacing.sm, paddingVertical: spacing.xs }}
        >
          <Text style={{ fontSize: font.sizes.sm, fontWeight: '700', color: colors.accent }}>Tier</Text>
        </Pressable>
        <Pressable onPress={handleSignOut} accessibilityRole="button" accessibilityLabel="Sign out" style={{ padding: spacing.xs }}>
          <Icon name="signout" size={22} color={colors.ink2} accessibilityLabel="Sign out" />
        </Pressable>
      </View>

      <ScrollView
        contentContainerStyle={{ padding: spacing.lg, paddingBottom: insets.bottom + spacing.xxl, gap: spacing.xl }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.accent} />}
      >
        {orders.length === 0 && (
          <View style={{ alignItems: 'center', paddingVertical: spacing.xxxl * 2, gap: spacing.md }}>
            <Icon name="bell" size={40} color={colors.ink3} accessibilityLabel="No orders" />
            <Text style={{ fontSize: font.sizes.lg, color: colors.ink2 }}>Waiting for orders…</Text>
            <Text style={{ fontSize: font.sizes.sm, color: colors.ink3, textAlign: 'center' }}>
              New orders appear here instantly with a sound alert.
            </Text>
          </View>
        )}

        <Section title="New" count={incoming.length} accent>
          {incoming.map((o) => (
            <OrderRow
              key={o.id}
              order={o}
              busy={busyIds.has(o.id)}
              onAccept={() => doAdvance(o, 'accepted')}
              onReject={(reason) => doAdvance(o, 'rejected', reason)}
            />
          ))}
        </Section>

        <Section title="In kitchen" count={inKitchen.length}>
          {inKitchen.map((o) => (
            <OrderRow
              key={o.id}
              order={o}
              busy={busyIds.has(o.id)}
              primary={
                o.status === 'accepted'
                  ? { label: 'Start preparing', next: 'preparing' }
                  : { label: 'Mark ready', next: 'ready' }
              }
              onPrimary={(next) => doAdvance(o, next)}
            />
          ))}
        </Section>

        <Section title="Ready / picked up" count={ready.length}>
          {ready.map((o) => (
            <OrderRow key={o.id} order={o} busy={busyIds.has(o.id)} />
          ))}
        </Section>
      </ScrollView>
    </View>
  );
}

// ── Section ──────────────────────────────────────────────────────────────────
function Section({
  title,
  count,
  accent,
  children,
}: {
  title: string;
  count: number;
  accent?: boolean;
  children: React.ReactNode;
}) {
  if (count === 0) return null;
  return (
    <View style={{ gap: spacing.md }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
        <Text style={{ fontSize: font.sizes.sm, fontWeight: '800', letterSpacing: 1, textTransform: 'uppercase', color: accent ? colors.accent : colors.ink2 }}>
          {title}
        </Text>
        <View style={{ minWidth: 22, alignItems: 'center', borderRadius: radius.pill, backgroundColor: accent ? colors.accentSoft : colors.sand, paddingHorizontal: 8, paddingVertical: 2 }}>
          <Text style={{ fontSize: font.sizes.xs, fontWeight: '700', color: accent ? colors.accentDark : colors.ink2 }}>{count}</Text>
        </View>
      </View>
      {children}
    </View>
  );
}

// ── Order row (card) ─────────────────────────────────────────────────────────
function OrderRow({
  order,
  busy,
  onAccept,
  onReject,
  primary,
  onPrimary,
}: {
  order: RestaurantOrder;
  busy: boolean;
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
      ? `${addr.hotelName ?? 'Hotel'} · Room ${addr.roomNumber ?? '—'}`
      : addr?.kind === 'street'
        ? `${addr.streetText ?? ''} ${addr.building ?? ''}`.trim() || 'Address'
        : addr?.kind === 'beach_pin'
          ? `Beach · ${addr.beachName ?? ''}`
          : (addr?.label ?? 'Address');

  return (
    <View style={{ borderWidth: 1, borderColor: colors.line, borderRadius: radius.xl, backgroundColor: colors.white, padding: spacing.lg, gap: spacing.sm }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <View>
          <Text style={{ fontWeight: '800', fontSize: font.sizes.lg, color: colors.ink }}>{order.short_code}</Text>
          <Text style={{ fontSize: font.sizes.xs, color: colors.ink3 }}>
            {new Date(order.placed_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            {order.scheduled_for
              ? ` · scheduled ${new Date(order.scheduled_for).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
              : ''}
          </Text>
        </View>
        <View style={{ alignItems: 'flex-end' }}>
          <Text style={{ fontWeight: '800', fontSize: font.sizes.lg, color: colors.ink }}>{order.total_egp} EGP</Text>
          <Text style={{ fontSize: font.sizes.xs, fontWeight: '700', color: order.payment_method === 'cash_on_delivery' ? colors.sea : order.payment_status === 'paid' ? colors.green : colors.amber }}>
            {order.payment_method === 'cash_on_delivery' ? 'Cash on delivery' : `Card · ${order.payment_status}`}
          </Text>
        </View>
      </View>

      {/* Items */}
      <View style={{ gap: 2 }}>
        {order.items?.map((it, i) => (
          <Text key={i} style={{ fontSize: font.sizes.base, color: colors.ink }}>
            <Text style={{ fontWeight: '700' }}>{it.quantity}× </Text>
            {it.name}
            {it.modifierChoices && it.modifierChoices.length > 0 ? (
              <Text style={{ color: colors.ink3 }}>
                {' '}
                ({it.modifierChoices.map((m) => m.optionName).filter(Boolean).join(', ')})
              </Text>
            ) : null}
          </Text>
        ))}
      </View>

      {order.kitchen_notes ? (
        <View style={{ backgroundColor: colors.amberSoft, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm }}>
          <Text style={{ fontSize: font.sizes.xs, color: colors.amber }}>Kitchen note: {order.kitchen_notes}</Text>
        </View>
      ) : null}

      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, borderTopWidth: 1, borderTopColor: colors.line, paddingTop: spacing.sm }}>
        <Icon name="location" size={13} color={colors.ink3} />
        <Text style={{ flex: 1, fontSize: font.sizes.xs, color: colors.ink2 }} numberOfLines={1}>{addrLine}</Text>
        <View style={{ borderRadius: radius.sm, backgroundColor: colors.sand, paddingHorizontal: 6, paddingVertical: 2 }}>
          <Text style={{ fontSize: 9, textTransform: 'uppercase', color: colors.ink2 }}>
            {order.fulfillment_type === 'self_delivery' ? 'self-delivery' : 'platform fleet'}
          </Text>
        </View>
      </View>

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
            style={{ borderWidth: 1, borderColor: colors.line, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, backgroundColor: colors.white, color: colors.ink }}
          />
          <View style={{ flexDirection: 'row', gap: spacing.sm }}>
            <Pressable onPress={() => { setRejecting(false); setReason(''); }} style={{ flex: 1, borderWidth: 1, borderColor: colors.line, borderRadius: radius.md, paddingVertical: spacing.md, alignItems: 'center' }}>
              <Text style={{ fontSize: font.sizes.sm, fontWeight: '700', color: colors.ink2 }}>Cancel</Text>
            </Pressable>
            <Pressable onPress={() => onReject(reason.trim() || undefined)} style={{ flex: 1, backgroundColor: colors.red, borderRadius: radius.md, paddingVertical: spacing.md, alignItems: 'center' }}>
              <Text style={{ fontSize: font.sizes.sm, fontWeight: '700', color: colors.white }}>Confirm reject</Text>
            </Pressable>
          </View>
        </View>
      ) : (onAccept || onReject || primary) ? (
        <View style={{ flexDirection: 'row', gap: spacing.sm }}>
          {onReject && (
            <Pressable onPress={() => setRejecting(true)} disabled={busy} style={{ flex: 1, borderWidth: 1, borderColor: colors.line, borderRadius: radius.lg, paddingVertical: spacing.md, alignItems: 'center', opacity: busy ? 0.5 : 1 }}>
              <Text style={{ fontSize: font.sizes.base, fontWeight: '700', color: colors.red }}>Reject</Text>
            </Pressable>
          )}
          {onAccept && (
            <Pressable onPress={onAccept} disabled={busy} style={{ flex: 1, backgroundColor: colors.green, borderRadius: radius.lg, paddingVertical: spacing.md, alignItems: 'center', opacity: busy ? 0.6 : 1 }}>
              {busy ? <ActivityIndicator color={colors.white} /> : <Text style={{ fontSize: font.sizes.base, fontWeight: '700', color: colors.white }}>Accept</Text>}
            </Pressable>
          )}
          {primary && onPrimary && (
            <Pressable onPress={() => onPrimary(primary.next)} disabled={busy} style={{ flex: 1, backgroundColor: colors.accent, borderRadius: radius.lg, paddingVertical: spacing.md, alignItems: 'center', opacity: busy ? 0.6 : 1 }}>
              {busy ? <ActivityIndicator color={colors.white} /> : <Text style={{ fontSize: font.sizes.base, fontWeight: '700', color: colors.white }}>{primary.label}</Text>}
            </Pressable>
          )}
        </View>
      ) : null}
    </View>
  );
}
