import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useToast } from '../../src/components/Toast';
import { Icon } from '../../src/components/Icon';
import { AllergenBanner } from '../../src/components/AllergenBanner';
import { ContactButtons } from '../../src/components/ContactButtons';
import {
  allergenLabel,
  getOrder,
  subscribeOrders,
  type RestaurantOrder,
} from '../../src/orders';
import { colors, font, radius, spacing } from '../../src/theme';

/** Format the delivery address for the kitchen from its snapshot. */
function addressLine(order: RestaurantOrder): string {
  const addr = order.address_snapshot;
  if (!addr) return 'Address';
  if (addr.kind === 'hotel') return `${addr.hotelName ?? 'Hotel'} · Room ${addr.roomNumber ?? '—'}`;
  if (addr.kind === 'street') return `${addr.streetText ?? ''} ${addr.building ?? ''}`.trim() || 'Address';
  if (addr.kind === 'beach_pin') return `Beach · ${addr.beachName ?? ''}`;
  return addr.label ?? 'Address';
}

/**
 * Full order detail for the kitchen: the authoritative allergen briefing, every
 * line with its modifiers / per-item allergens / notes, the order-wide kitchen
 * note, delivery address, and contact entry points (call + in-app chat).
 */
export default function OrderDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { toast } = useToast();

  const [order, setOrder] = useState<RestaurantOrder | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    try {
      const row = await getOrder(id);
      if (!row) {
        setNotFound(true);
      } else {
        setOrder(row);
      }
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not load order', 'error');
    } finally {
      setLoading(false);
    }
  }, [id, toast]);

  useEffect(() => {
    load();
  }, [load]);

  // Keep the detail live: if the order changes (status, etc.) reflect it here.
  useEffect(() => {
    if (!order) return;
    const unsub = subscribeOrders(
      order.restaurant_id,
      `detail:${order.id}`,
      (row) => {
        if (row.id === order.id) setOrder((prev) => (prev ? { ...prev, ...row } : prev));
      },
      () => {
        getOrder(order.id)
          .then((row) => {
            if (row) setOrder(row);
          })
          .catch(() => {});
      },
    );
    return unsub;
  }, [order?.id, order?.restaurant_id]);

  if (loading) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg }}>
        <ActivityIndicator color={colors.accent} size="large" />
      </View>
    );
  }

  if (notFound || !order) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xxl, backgroundColor: colors.bg, gap: spacing.md }}>
        <Text style={{ fontSize: font.sizes.lg, fontWeight: '700', color: colors.ink }}>Order not found</Text>
        <Pressable onPress={() => router.back()} style={{ padding: spacing.md }}>
          <Text style={{ color: colors.accent, fontWeight: '700' }}>Go back</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      {/* Back header */}
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
          gap: spacing.sm,
        }}
      >
        <Pressable
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel="Back"
          hitSlop={8}
          style={{ padding: spacing.xs }}
        >
          <Icon name="chevronBack" size={24} color={colors.ink} accessibilityLabel="Back" />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: font.sizes.lg, fontWeight: '800', color: colors.ink }}>{order.short_code}</Text>
          <Text style={{ fontSize: font.sizes.xs, color: colors.ink3 }}>
            {new Date(order.placed_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} · {order.status}
          </Text>
        </View>
        <Text style={{ fontSize: font.sizes.lg, fontWeight: '800', color: colors.ink }}>{order.total_egp} EGP</Text>
      </View>

      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: insets.bottom + spacing.xxl, gap: spacing.lg }}>
        {/* Allergy briefing — first, so it can't be missed. */}
        <AllergenBanner allergens={order.aggregate_allergens} />

        {/* Items */}
        <View style={{ borderWidth: 1, borderColor: colors.line, borderRadius: radius.xl, backgroundColor: colors.white, padding: spacing.lg, gap: spacing.md }}>
          <Text style={{ fontSize: font.sizes.sm, fontWeight: '800', letterSpacing: 1, textTransform: 'uppercase', color: colors.ink2 }}>
            Items
          </Text>
          {order.items?.map((it, i) => (
            <View key={i} style={{ gap: 2 }}>
              <Text style={{ fontSize: font.sizes.base, color: colors.ink }}>
                <Text style={{ fontWeight: '800' }}>{it.quantity}× </Text>
                {it.name}
              </Text>
              {it.modifierChoices && it.modifierChoices.length > 0 ? (
                <Text style={{ fontSize: font.sizes.sm, color: colors.ink3, marginLeft: spacing.md }}>
                  {it.modifierChoices.map((m) => m.optionName).filter(Boolean).join(', ')}
                </Text>
              ) : null}
              {it.allergens && it.allergens.length > 0 ? (
                <Text style={{ fontSize: font.sizes.sm, color: colors.red, marginLeft: spacing.md, fontWeight: '700' }}>
                  Contains: {it.allergens.map(allergenLabel).join(', ')}
                </Text>
              ) : null}
              {it.notes ? (
                <Text style={{ fontSize: font.sizes.sm, color: colors.amber, marginLeft: spacing.md }}>
                  “{it.notes}”
                </Text>
              ) : null}
            </View>
          ))}
        </View>

        {/* Kitchen note */}
        {order.kitchen_notes ? (
          <View style={{ backgroundColor: colors.amberSoft, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm }}>
            <Text style={{ fontSize: font.sizes.xs, fontWeight: '700', color: colors.amber }}>Kitchen note</Text>
            <Text style={{ fontSize: font.sizes.base, color: colors.amber }}>{order.kitchen_notes}</Text>
          </View>
        ) : null}

        {/* Delivery */}
        <View style={{ borderWidth: 1, borderColor: colors.line, borderRadius: radius.xl, backgroundColor: colors.white, padding: spacing.lg, gap: spacing.sm }}>
          <Text style={{ fontSize: font.sizes.sm, fontWeight: '800', letterSpacing: 1, textTransform: 'uppercase', color: colors.ink2 }}>
            Delivery
          </Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Icon name="location" size={14} color={colors.ink3} />
            <Text style={{ flex: 1, fontSize: font.sizes.base, color: colors.ink }}>{addressLine(order)}</Text>
          </View>
          <Text style={{ fontSize: font.sizes.xs, color: colors.ink3 }}>
            {order.fulfillment_type === 'self_delivery' ? 'Self-delivery' : 'Platform fleet'} ·{' '}
            {order.payment_method === 'cash_on_delivery' ? 'Cash on delivery' : `Card · ${order.payment_status}`}
          </Text>
        </View>

        {/* Contact */}
        <View style={{ gap: spacing.sm }}>
          <Text style={{ fontSize: font.sizes.sm, fontWeight: '800', letterSpacing: 1, textTransform: 'uppercase', color: colors.ink2 }}>
            Contact
          </Text>
          <ContactButtons orderId={order.id} customerPhone={order.customer_phone} />
        </View>
      </ScrollView>
    </View>
  );
}
