import { useEffect, useMemo, useState } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as WebBrowser from 'expo-web-browser';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BackButton } from '../src/components/BackButton';
import { PrimaryButton } from '../src/components/PrimaryButton';
import { KitchenBriefing } from '../src/components/KitchenBriefing';
import { colors, font, radius, shadow } from '../src/theme';
import { useT } from '../src/i18n';
import { useCart } from '../src/store/cart';
import { useSession, type Currency } from '../src/store/session';
import { db } from '../src/data';
import type { Address, AllergyKey, PaymentMethod, Restaurant } from '../src/data/types';
import { formatEgp, formatTime } from '../src/lib/format';
import { formatCurrency, fxRateLine, ALL_CURRENCIES } from '../src/currency/fx';
import { success, selection } from '../src/haptics';

export default function Checkout() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const t = useT();
  const lines = useCart((s) => s.lines);
  const restaurantId = useCart((s) => s.restaurantId);
  const restaurantName = useCart((s) => s.restaurantName);
  const subtotal = useCart((s) => s.subtotal());
  const clear = useCart((s) => s.clear);

  const selectedAddressId = useSession((s) => s.selectedAddressId);
  const currency = useSession((s) => s.currency);
  const setCurrency = useSession((s) => s.setCurrency);
  const locale = useSession((s) => s.locale);
  // Hide the FX/currency picker for locals on the default rail (AR + EGP).
  const showCurrencyPicker = !(locale === 'ar' && currency === 'EGP');

  const [address, setAddress] = useState<Address | null>(null);
  const [payment, setPayment] = useState<PaymentMethod | null>(null);
  const [restaurant, setRestaurant] = useState<Restaurant | null>(null);
  const [tipEgp, setTipEgp] = useState(0);
  const [placing, setPlacing] = useState(false);
  const [currencyOpen, setCurrencyOpen] = useState(false);
  const [kitchenNotes, setKitchenNotes] = useState('');
  const [scheduledFor, setScheduledFor] = useState<number | null>(null);
  const [paymentError, setPaymentError] = useState<string | null>(null);

  // Generate 8 half-hour slots starting at the next half hour, capped at ~4h.
  const scheduleSlots = useMemo<number[]>(() => {
    const now = Date.now();
    const firstSlot = new Date(now);
    firstSlot.setSeconds(0, 0);
    firstSlot.setMinutes(firstSlot.getMinutes() < 30 ? 30 : 60);
    const slots: number[] = [];
    for (let i = 0; i < 8; i++) {
      slots.push(firstSlot.getTime() + i * 30 * 60_000);
    }
    return slots;
  }, []);

  // Aggregate distinct allergens across all cart lines.
  const aggregateAllergens = useMemo<AllergyKey[]>(() => {
    const set = new Set<AllergyKey>();
    for (const l of lines) {
      for (const a of l.allergens ?? []) set.add(a);
    }
    return Array.from(set);
  }, [lines]);

  useEffect(() => {
    if (!selectedAddressId) return;
    db.user.listAddresses().then((all) => {
      setAddress(all.find((a) => a.id === selectedAddressId) ?? all[0] ?? null);
    });
  }, [selectedAddressId]);

  useEffect(() => {
    db.user.listPaymentMethods().then((pms) => {
      setPayment(pms.find((p) => p.isDefault) ?? pms[0] ?? null);
    });
  }, []);

  useEffect(() => {
    if (!restaurantId) return;
    db.restaurants.get(restaurantId).then(setRestaurant);
  }, [restaurantId]);

  const deliveryFee = restaurant?.deliveryFeeEgp ?? 30;
  const tax = useMemo(() => Math.round(subtotal * 0.14), [subtotal]);
  const total = subtotal + deliveryFee + tax + tipEgp;

  const isCard = payment?.kind === 'card' || payment?.kind === 'apple_pay';

  const place = async () => {
    if (!restaurant || !address || !payment || lines.length === 0) return;
    setPlacing(true);
    try {
      // place_order (server-authoritative). Returns the created order.
      const order = await db.orders.create({
        restaurantId: restaurant.id,
        restaurantName: restaurant.name,
        items: lines,
        address,
        payment: { kind: payment.kind, label: payment.label },
        tipEgp,
        deliveryFeeEgp: deliveryFee,
        kitchenNotes: kitchenNotes.trim() || undefined,
        aggregateAllergens: aggregateAllergens.length > 0 ? aggregateAllergens : undefined,
        scheduledFor: scheduledFor ?? undefined,
      });

      // Card payment: open Paymob hosted checkout. The order stays 'pending'
      // (and hidden from the merchant) until the HMAC-verified webhook flips it
      // to 'paid'. COD orders skip this entirely and go straight to tracking.
      if (isCard) {
        const intent = await db.orders.startCardPayment(order.id);
        if (intent?.checkoutUrl) {
          // Opens the secure hosted checkout; card data never touches the app.
          await WebBrowser.openBrowserAsync(intent.checkoutUrl);
          // On return we route to tracking; the webhook confirms payment
          // out-of-band, so the tracking screen reflects the real status.
        }
      }

      success();
      clear();
      router.replace(`/order/${order.id}`);
    } catch (e) {
      setPaymentError(e instanceof Error ? e.message : 'Could not place your order.');
    } finally {
      setPlacing(false);
    }
  };

  const addrText =
    address?.kind === 'hotel'
      ? `${address.hotelName ?? t('address.hotel')} · ${t('address.room')} ${address.roomNumber ?? '-'}`
      : address?.kind === 'street'
        ? `${address.streetText ?? t('address.title')}`
        : address?.kind === 'beach_pin'
          ? `${t('address.beachPin')} · ${address.beachName ?? 'Sharks Bay'}`
          : t('address.chooseAddress');

  const handoffText =
    address?.kind === 'hotel'
      ? address.handoff === 'lobby'
        ? t('address.lobby')
        : address.handoff === 'reception'
          ? t('address.reception')
          : t('address.poolside')
      : address?.kind === 'street'
        ? `${address.building ?? ''} ${address.apartment ?? ''}`.trim()
        : address?.kind === 'beach_pin'
          ? t('address.tapToPin')
          : '';

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <StatusBar style="dark" />
      <View style={[styles.head, { paddingTop: insets.top + 12 }]}>
        <BackButton />
        <Text style={styles.title}>{t('checkout.title')}</Text>
        <View style={{ width: 38 }} />
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 200 }}>
        {/* Address card */}
        <View style={styles.card}>
          <View style={styles.cardHead}>
            <Text style={styles.cardTitle}>{t('checkout.deliverTo')}</Text>
            <Pressable onPress={() => router.push('/address/picker')}>
              <Text style={styles.edit}>{t('checkout.change')}</Text>
            </Pressable>
          </View>
          <View style={styles.addr}>
            <View style={styles.pin}>
              <Text style={{ color: colors.white, fontSize: 18 }}>📍</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.hotelName}>{addrText}</Text>
              {!!handoffText && <Text style={styles.handoff}>{handoffText}</Text>}
              {address?.kind === 'hotel' && (
                <View style={styles.tagWrap}>
                  <Text style={styles.tag}>{t('address.verifiedHotelTag')}</Text>
                </View>
              )}
            </View>
          </View>
        </View>

        {/* Cart preview */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>{t('cart.from', { name: restaurantName ?? '' })}</Text>
          <View style={{ marginTop: 10, gap: 12 }}>
            {lines.map((l) => (
              <View key={l.lineId} style={styles.cartLine}>
                <View style={styles.cartQty}>
                  <Text style={styles.cartQtyText}>{l.quantity}×</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.cartName}>{l.name}</Text>
                  {l.modifierChoices.length > 0 && (
                    <Text style={styles.cartMods}>
                      {l.modifierChoices.map((c) => c.optionName).join(' · ')}
                    </Text>
                  )}
                </View>
                <Text style={styles.cartPrice}>
                  {formatEgp(
                    (l.basePriceEgp + l.modifierChoices.reduce((a, c) => a + c.priceDeltaEgp, 0)) *
                      l.quantity,
                  )}
                </Text>
              </View>
            ))}
          </View>
        </View>

        {/* Timing */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>{t('checkout.timing')}</Text>
          <View style={styles.timingRow}>
            <Pressable
              onPress={() => {
                selection();
                setScheduledFor(null);
              }}
              style={[styles.timingChip, scheduledFor === null && styles.timingChipActive]}>
              <Text style={[styles.timingChipText, scheduledFor === null && { color: colors.white }]}>
                ⚡ {t('checkout.timingAsap')}
              </Text>
            </Pressable>
            {scheduleSlots.map((slot) => {
              const isSel = scheduledFor === slot;
              return (
                <Pressable
                  key={slot}
                  onPress={() => {
                    selection();
                    setScheduledFor(slot);
                  }}
                  style={[styles.timingChip, isSel && styles.timingChipActive]}>
                  <Text style={[styles.timingChipText, isSel && { color: colors.white }]}>
                    {formatTime(new Date(slot))}
                  </Text>
                </Pressable>
              );
            })}
          </View>
          {scheduledFor !== null && (
            <Text style={styles.scheduledLine}>
              📅 {t('checkout.scheduledFor', { time: formatTime(new Date(scheduledFor)) })}
            </Text>
          )}
        </View>

        {/* Kitchen briefing */}
        <KitchenBriefing
          allergens={aggregateAllergens}
          notes={kitchenNotes}
          onChangeNotes={setKitchenNotes}
        />

        {/* Payment card */}
        <View style={styles.card}>
          <View style={styles.cardHead}>
            <Text style={styles.cardTitle}>{t('checkout.payWith')}</Text>
            {showCurrencyPicker && (
              <Pressable onPress={() => setCurrencyOpen((o) => !o)}>
                <View style={styles.currencyChip}>
                  <Text style={styles.currencyText}>{currency} ⇄</Text>
                </View>
              </Pressable>
            )}
          </View>
          {showCurrencyPicker && currencyOpen && (
            <View style={styles.currencyRow}>
              {ALL_CURRENCIES.map((c) => (
                <Pressable
                  key={c}
                  onPress={() => {
                    selection();
                    setCurrency(c as Currency);
                    setCurrencyOpen(false);
                  }}
                  style={[styles.curBtn, currency === c && styles.curBtnActive]}>
                  <Text style={[styles.curBtnText, currency === c && { color: colors.white }]}>{c}</Text>
                </Pressable>
              ))}
            </View>
          )}
          <Pressable onPress={() => router.push('/payment/picker')} style={styles.payChosen}>
            <Text style={styles.payIcon}>{paymentIcon(payment?.kind)}</Text>
            <View style={{ flex: 1 }}>
              <Text style={styles.payLabel}>{payment?.label ?? 'Choose payment'}</Text>
              <Text style={styles.paySub}>{payment?.subline ?? ''}</Text>
            </View>
            <Text style={styles.chev}>›</Text>
          </Pressable>
        </View>

        {/* Tip card */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>{t('checkout.tip')}</Text>
          <View style={styles.tipRow}>
            {[0, 10, 20, 50].map((amt) => (
              <Pressable
                key={amt}
                onPress={() => {
                  selection();
                  setTipEgp(amt);
                }}
                style={[styles.tipBtn, tipEgp === amt && styles.tipBtnActive]}>
                <Text style={[styles.tipText, tipEgp === amt && { color: colors.white }]}>
                  {amt === 0 ? t('checkout.tipNone') : formatEgp(amt)}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>

        {/* Totals */}
        <View style={styles.card}>
          <View style={styles.totRow}>
            <Text style={styles.totLabel}>{t('checkout.subtotal')}</Text>
            <Text style={styles.totVal}>{formatEgp(subtotal)}</Text>
          </View>
          <View style={styles.totRow}>
            <Text style={styles.totLabel}>{t('checkout.delivery')}</Text>
            <Text style={styles.totVal}>{formatEgp(deliveryFee)}</Text>
          </View>
          <View style={styles.totRow}>
            <Text style={styles.totLabel}>{t('checkout.tax')}</Text>
            <Text style={styles.totVal}>{formatEgp(tax)}</Text>
          </View>
          {tipEgp > 0 && (
            <View style={styles.totRow}>
              <Text style={styles.totLabel}>{t('checkout.tip')}</Text>
              <Text style={styles.totVal}>{formatEgp(tipEgp)}</Text>
            </View>
          )}
          <View style={[styles.totRow, styles.totTotal]}>
            <Text style={styles.totTotalLabel}>{t('checkout.total')}</Text>
            <Text style={styles.totTotalVal}>{formatEgp(total)}</Text>
          </View>
          {currency !== 'EGP' && (
            <Text style={styles.conv}>
              {t('checkout.conversion', {
                amount: formatCurrency(total, currency as Currency),
                rate: fxRateLine(currency as Currency) ?? '',
              })}
            </Text>
          )}
        </View>
      </ScrollView>

      <View style={[styles.bottom, { paddingBottom: 24 + insets.bottom }]}>
        {paymentError && (
          <View style={styles.payErr}>
            <Text style={styles.payErrText}>{paymentError}</Text>
          </View>
        )}
        {isCard && (
          <Text style={styles.cardHint}>
            {t('checkout.cardHint') !== 'checkout.cardHint'
              ? t('checkout.cardHint')
              : "You'll complete payment securely on the next screen."}
          </Text>
        )}
        <PrimaryButton
          label={
            isCard
              ? t('checkout.payCard', { amount: formatEgp(total) }) !== 'checkout.payCard'
                ? t('checkout.payCard', { amount: formatEgp(total) })
                : `Pay ${formatEgp(total)}`
              : t('checkout.place', { amount: formatEgp(total) })
          }
          onPress={place}
          disabled={placing || !address || !payment || lines.length === 0}
        />
      </View>
    </View>
  );
}

function paymentIcon(kind?: PaymentMethod['kind']): string {
  switch (kind) {
    case 'cash':
      return '💵';
    case 'vodafone_cash':
      return '📱';
    case 'instapay':
      return '💸';
    case 'fawry':
      return '🟧';
    case 'card':
      return '💳';
    case 'apple_pay':
      return '';
    default:
      return '➜';
  }
}

const styles = StyleSheet.create({
  head: {
    paddingHorizontal: 16,
    paddingBottom: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.bg,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  title: { fontSize: font.sizes['5xl'], fontWeight: font.weights.extrabold, color: colors.ink, letterSpacing: -0.4 },
  card: {
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.xl,
    padding: 14,
    marginBottom: 12,
    ...shadow.soft,
  },
  cardHead: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  cardTitle: { fontSize: font.sizes['2xl'], fontWeight: font.weights.bold, color: colors.ink },
  edit: { fontSize: font.sizes.md, color: colors.sea, fontWeight: font.weights.bold },
  addr: { flexDirection: 'row', gap: 12 },
  pin: { width: 38, height: 38, borderRadius: 11, backgroundColor: colors.sea, alignItems: 'center', justifyContent: 'center' },
  hotelName: { fontSize: font.sizes.xl, fontWeight: font.weights.bold, color: colors.ink },
  handoff: { fontSize: font.sizes.md, color: colors.ink2, marginTop: 2 },
  tagWrap: { marginTop: 8, alignSelf: 'flex-start' },
  tag: {
    backgroundColor: colors.seaSoft,
    color: colors.sea,
    fontSize: 10.5,
    fontWeight: font.weights.bold,
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: radius.pill,
  },
  cartLine: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  cartQty: { backgroundColor: colors.sand, borderRadius: 6, paddingHorizontal: 7, paddingVertical: 3 },
  cartQtyText: { fontSize: font.sizes.md, fontWeight: font.weights.bold, color: colors.ink },
  cartName: { fontSize: font.sizes.lg, color: colors.ink, fontWeight: font.weights.semibold },
  cartMods: { fontSize: font.sizes.sm, color: colors.ink2, marginTop: 2 },
  cartPrice: { fontSize: font.sizes.lg, fontWeight: font.weights.bold, color: colors.ink },
  currencyChip: { backgroundColor: colors.seaSoft, borderRadius: radius.pill, paddingHorizontal: 12, paddingVertical: 5 },
  currencyText: { color: colors.sea, fontSize: font.sizes.md, fontWeight: font.weights.bold },
  currencyRow: { flexDirection: 'row', gap: 6, flexWrap: 'wrap', marginBottom: 10 },
  curBtn: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: radius.pill, backgroundColor: colors.bgSoft },
  curBtnActive: { backgroundColor: colors.ink },
  curBtnText: { fontSize: font.sizes.md, color: colors.ink, fontWeight: font.weights.bold },
  payChosen: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: radius.lg,
    backgroundColor: colors.bgSoft,
  },
  payIcon: { fontSize: 22, width: 28, textAlign: 'center' },
  payLabel: { fontSize: font.sizes.xl, color: colors.ink, fontWeight: font.weights.bold },
  paySub: { fontSize: font.sizes.md, color: colors.ink2, marginTop: 2 },
  chev: { fontSize: 22, color: colors.ink3 },
  timingRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap', marginTop: 10 },
  timingChip: {
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: radius.pill,
    backgroundColor: colors.bgSoft,
    borderWidth: 1,
    borderColor: colors.line,
  },
  timingChipActive: { backgroundColor: colors.ink, borderColor: colors.ink },
  timingChipText: { fontSize: font.sizes.lg, color: colors.ink, fontWeight: font.weights.bold },
  scheduledLine: {
    marginTop: 10,
    fontSize: font.sizes.lg,
    color: colors.sea,
    fontWeight: font.weights.bold,
  },
  tipRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  tipBtn: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.white,
  },
  tipBtnActive: { backgroundColor: colors.ink, borderColor: colors.ink },
  tipText: { fontSize: font.sizes.lg, color: colors.ink, fontWeight: font.weights.bold },
  totRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6 },
  totLabel: { fontSize: font.sizes.lg, color: colors.ink2 },
  totVal: { fontSize: font.sizes.lg, color: colors.ink, fontWeight: font.weights.semibold },
  totTotal: {
    borderTopWidth: 1,
    borderTopColor: colors.line,
    borderStyle: 'dashed',
    marginTop: 8,
    paddingTop: 12,
  },
  totTotalLabel: { fontSize: font.sizes['3xl'], fontWeight: font.weights.extrabold, color: colors.ink },
  totTotalVal: { fontSize: font.sizes['3xl'], fontWeight: font.weights.extrabold, color: colors.ink },
  conv: { marginTop: 8, fontSize: font.sizes.md, color: colors.sea },
  bottom: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colors.white,
    borderTopWidth: 1,
    borderTopColor: colors.line,
    paddingHorizontal: 16,
    paddingTop: 12,
  },
  cardHint: {
    fontSize: font.sizes.sm,
    color: colors.ink3,
    textAlign: 'center',
    marginBottom: 8,
  },
  payErr: {
    backgroundColor: colors.redSoft,
    borderRadius: radius.md,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginBottom: 8,
  },
  payErrText: {
    color: colors.red,
    fontSize: font.sizes.sm,
  },
});
