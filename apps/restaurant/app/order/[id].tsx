import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useToast } from '../../src/components/Toast';
import { Icon } from '../../src/components/Icon';
import { AllergenBanner } from '../../src/components/AllergenBanner';
import { ContactButtons } from '../../src/components/ContactButtons';
import {
  getMyKitchen,
  getOrder,
  subscribeOrders,
  type RestaurantOrder,
} from '../../src/orders';
import { font, radius, spacing } from '../../src/theme';
import { useThemeColors } from '../../src/themeProvider';
import { useLocale } from '../../src/locale';
import type { TranslationKey, TranslationParams } from '../../src/i18n';
import { captureError } from '../../src/lib/crash';
import { operationalErrorKey } from '../../src/operationalErrors';

/** Format the delivery address for the kitchen from its snapshot. */
type Translate = (key: TranslationKey, params?: TranslationParams) => string;

function addressLine(order: RestaurantOrder, t: Translate): string {
  const addr = order.address_snapshot;
  if (!addr) return t('order.address');
  if (addr.kind === 'hotel') {
    return `${addr.hotelName ?? t('order.hotel')} · ${t('order.room')} ${
      addr.roomNumber ?? '—'
    }`;
  }
  if (addr.kind === 'street') {
    return `${addr.streetText ?? ''} ${addr.building ?? ''}`.trim() || t('order.address');
  }
  if (addr.kind === 'beach_pin') return `${t('order.beach')} · ${addr.beachName ?? ''}`;
  return addr.label ?? t('order.address');
}

/**
 * Full order detail for the kitchen: the authoritative allergen briefing, every
 * line with its modifiers / per-item allergens / notes, the order-wide kitchen
 * note, delivery address, and contact entry points (call + in-app chat).
 */
export default function OrderDetail() {
  const colors = useThemeColors();
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { toast } = useToast();
  const { direction, isRtl, t } = useLocale();

  const [order, setOrder] = useState<RestaurantOrder | null>(null);
  const [brandTag, setBrandTag] = useState<string | undefined>(undefined);

  // Same rule as the queue: only multi-brand kitchens tag; a single-brand
  // merchant never sees a chip. Failure means no chip, never a broken screen.
  useEffect(() => {
    if (!order?.restaurant_id) return;
    getMyKitchen()
      .then((k) => {
        if (k?.isMultiBrand) {
          setBrandTag(k.brands.find((b) => b.restaurantId === order.restaurant_id)?.shortName);
        }
      })
      .catch(() => {});
  }, [order?.restaurant_id]);
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
      captureError(e, { where: 'restaurant.order.load', orderId: id });
      toast(t(operationalErrorKey('orderLoad')), 'error');
    } finally {
      setLoading(false);
    }
  }, [id, toast, t]);

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
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xxl, backgroundColor: colors.bg, gap: spacing.md, direction }}>
        <Text style={{ fontSize: font.sizes.lg, fontWeight: '700', color: colors.ink }}>{t('detail.notFound')}</Text>
        <Pressable onPress={() => router.back()} style={{ padding: spacing.md }}>
          <Text style={{ color: colors.accentText, fontWeight: '700' }}>{t('detail.goBack')}</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg, direction }}>
      {/* Live order summary */}
      <View
        style={{
          paddingTop: spacing.md,
          paddingHorizontal: spacing.lg,
          paddingBottom: spacing.md,
          backgroundColor: colors.surface,
          borderBottomWidth: 1,
          borderBottomColor: colors.line,
          flexDirection: 'row',
          alignItems: 'center',
          gap: spacing.sm,
        }}
      >
        <View style={{ flex: 1 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
            <Text style={{ fontSize: font.sizes.lg, fontWeight: '800', color: colors.ink, writingDirection: 'ltr' }}>{order.short_code}</Text>
            {brandTag ? (
              // [P06 Stage 3] Brand identity rides on the ticket DETAIL too —
              // the queue already tags tickets, but the cook works from this
              // screen, and in a multi-brand kitchen "which brand's packaging
              // and station" is part of the order, not decoration.
              <View
                accessibilityLabel={t('order.brandA11y', { brand: brandTag })}
                style={{
                  backgroundColor: colors.ink,
                  borderRadius: radius.sm,
                  paddingHorizontal: 6,
                  paddingVertical: 2,
                }}
              >
                <Text style={{ fontSize: font.sizes.xs, fontWeight: '800', color: colors.white }}>
                  {brandTag}
                </Text>
              </View>
            ) : null}
          </View>
          <Text style={{ fontSize: font.sizes.xs, color: colors.ink3 }}>
            {new Date(order.placed_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} ·{' '}
            {t(`status.${order.status}`)}
          </Text>
        </View>
        <Text style={{ fontSize: font.sizes.lg, fontWeight: '800', color: colors.ink, writingDirection: 'ltr' }}>{order.total_egp} EGP</Text>
      </View>

      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{ padding: spacing.lg, paddingBottom: insets.bottom + spacing.xxl, gap: spacing.lg }}
      >
        {/* Allergy briefing — first, so it can't be missed. */}
        <AllergenBanner allergens={order.aggregate_allergens} />

        {/* Items */}
        <View style={{ borderWidth: 1, borderColor: colors.line, borderRadius: radius.xl, backgroundColor: colors.surface, padding: spacing.lg, gap: spacing.md }}>
          <Text style={{ fontSize: font.sizes.sm, fontWeight: '800', letterSpacing: isRtl ? 0 : 1, textTransform: isRtl ? 'none' : 'uppercase', color: colors.ink2 }}>
            {t('detail.items')}
          </Text>
          {order.items?.map((it, i) => (
            <View key={i} style={{ gap: 2 }}>
              <Text style={{ fontSize: font.sizes.base, color: colors.ink }}>
                <Text style={{ fontWeight: '800' }}>{it.quantity}× </Text>
                {it.name}
              </Text>
              {it.modifierChoices && it.modifierChoices.length > 0 ? (
                <Text style={{ fontSize: font.sizes.sm, color: colors.ink3, marginStart: spacing.md }}>
                  {it.modifierChoices.map((m) => m.optionName).filter(Boolean).join(', ')}
                </Text>
              ) : null}
              {it.allergens && it.allergens.length > 0 ? (
                <Text style={{ fontSize: font.sizes.sm, color: colors.redText, marginStart: spacing.md, fontWeight: '700' }}>
                  {t('detail.contains', {
                    allergens: it.allergens.map((allergen) => t(`allergen.${allergen}`)).join(', '),
                  })}
                </Text>
              ) : null}
              {/* Matches the allergen warning's shape deliberately: staff already
                  scan this column for "something about this line needs care".
                  States the ACTION, not just the property — the person packing
                  the bag needs to know to verify, not merely that it is Rx. */}
              {it.requiresPrescription ? (
                <Text
                  style={{ fontSize: font.sizes.sm, color: colors.redText, marginStart: spacing.md, fontWeight: '800' }}
                  accessibilityRole="text">
                  {t('detail.rx')}
                </Text>
              ) : null}
              {it.notes ? (
                <Text style={{ fontSize: font.sizes.sm, color: colors.amberText, marginStart: spacing.md }}>
                  “{it.notes}”
                </Text>
              ) : null}
            </View>
          ))}
        </View>

        {/* Kitchen note */}
        {order.kitchen_notes ? (
          <View style={{ backgroundColor: colors.amberSoft, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm }}>
            <Text style={{ fontSize: font.sizes.xs, fontWeight: '700', color: colors.amberText }}>{t('detail.kitchenNote')}</Text>
            <Text style={{ fontSize: font.sizes.base, color: colors.amberText }}>{order.kitchen_notes}</Text>
          </View>
        ) : null}

        {/* Delivery */}
        <View style={{ borderWidth: 1, borderColor: colors.line, borderRadius: radius.xl, backgroundColor: colors.surface, padding: spacing.lg, gap: spacing.sm }}>
          <Text style={{ fontSize: font.sizes.sm, fontWeight: '800', letterSpacing: isRtl ? 0 : 1, textTransform: isRtl ? 'none' : 'uppercase', color: colors.ink2 }}>
            {t('detail.delivery')}
          </Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Icon name="location" size={14} color={colors.ink3} />
            <Text style={{ flex: 1, fontSize: font.sizes.base, color: colors.ink }}>{addressLine(order, t)}</Text>
          </View>
          <Text style={{ fontSize: font.sizes.xs, color: colors.ink3 }}>
            {order.fulfillment_type === 'self_delivery'
              ? t('fulfillment.selfLabel')
              : t('fulfillment.platformLabel')}{' '}
            ·{' '}
            {order.payment_method === 'cash_on_delivery'
              ? t('payment.cashLabel')
              : t('payment.cardLabel', {
                  status: t(`payment.status.${order.payment_status}`),
                })}
          </Text>
        </View>

        {/* Contact */}
        <View style={{ gap: spacing.sm }}>
          <Text style={{ fontSize: font.sizes.sm, fontWeight: '800', letterSpacing: isRtl ? 0 : 1, textTransform: isRtl ? 'none' : 'uppercase', color: colors.ink2 }}>
            {t('detail.contact')}
          </Text>
          <ContactButtons orderId={order.id} customerPhone={order.customer_phone} />
        </View>
      </ScrollView>
    </View>
  );
}
