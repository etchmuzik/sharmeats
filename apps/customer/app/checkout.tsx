import { useEffect, useMemo, useRef, useState } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as WebBrowser from 'expo-web-browser';
// expo-crypto is imported lazily inside makeIdempotencyKey so a native-module
// failure can never throw at module-eval / checkout render. See the helper below.
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BackButton } from '../src/components/BackButton';
import { PrimaryButton } from '../src/components/PrimaryButton';
import { KitchenBriefing } from '../src/components/KitchenBriefing';
import { CheckoutStepper } from '../src/components/CheckoutStepper';
import { DropoffPreferenceCard } from '../src/components/DropoffPreferenceCard';
import { Icon, type IconName } from '../src/components/Icon';
import { colors, font, radius, shadow } from '../src/theme';
import { useT } from '../src/i18n';
import { useDirection } from '../src/lib/direction';
import { useCart } from '../src/store/cart';
import { useSession, type Currency } from '../src/store/session';
import { db } from '../src/data';
import type { Address, AllergyKey, DropoffPreference, PaymentMethod, Restaurant } from '../src/data/types';
import { formatEgp, formatTime } from '../src/lib/format';
import { formatCurrency, fxRateLine, ALL_CURRENCIES } from '../src/currency/fx';
import { success, selection } from '../src/haptics';
import { localizedPayment } from '../src/lib/payments';
import { captureError, track } from '../src/lib/analytics';

// Crash-safe idempotency key. Tries expo-crypto's randomUUID (best), but a native
// failure (module-init throw on some device/arch combos) must NEVER break checkout
// render — falls back to a plain JS UUIDv4. The value only needs to be unique per
// checkout attempt for place_order's dedup; cryptographic quality is not required.
function makeIdempotencyKey(): string {
  try {
    // Lazy require so the native module is only touched here, never at module-eval.
    const crypto = require('expo-crypto') as { randomUUID?: () => string };
    const id = crypto?.randomUUID?.();
    if (id) return id;
  } catch {
    // fall through to JS fallback
  }
  // RFC4122-ish v4 from Math.random — fine for a request-dedup token.
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export default function Checkout() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const t = useT();
  const dir = useDirection();
  const lines = useCart((s) => s.lines);
  const restaurantId = useCart((s) => s.restaurantId);
  const restaurantName = useCart((s) => s.restaurantName);
  const subtotal = useCart((s) => s.subtotal());
  const clear = useCart((s) => s.clear);

  // [031] Idempotency key for this checkout attempt. Stable across retries
  // (double-tap, network retry) so place_order returns the existing order
  // instead of creating a duplicate. Reset after a successful placement so a
  // subsequent order gets a fresh key.
  //
  // Generated lazily inside useRef's initializer (runs once, NOT on every
  // render) and guarded: a native randomUUID() failure must never throw during
  // checkout's render — it would trip the ScreenErrorBoundary. Falls back to a
  // plain JS UUID; the value only needs to be unique-per-checkout, not crypto.
  const idempotencyKey = useRef<string>(undefined as unknown as string);
  if (!idempotencyKey.current) idempotencyKey.current = makeIdempotencyKey();

  const selectedAddressId = useSession((s) => s.selectedAddressId);
  const sessionPhone = useSession((s) => s.phone);
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
  const [dropoffPreference, setDropoffPreference] = useState<DropoffPreference | null>(null);
  // dropoffNote is threaded through to db.orders.create() but has no UI input
  // yet in this pass — reserved for a future "add a note" affordance.
  const [dropoffNote, setDropoffNote] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [scheduledFor, setScheduledFor] = useState<number | null>(null);
  const [paymentError, setPaymentError] = useState<string | null>(null);
  const [quotedFee, setQuotedFee] = useState<number | null>(null);
  const [promoInput, setPromoInput] = useState('');
  const [promoApplied, setPromoApplied] = useState<{ code: string; discount: number } | null>(null);
  const [promoError, setPromoError] = useState(false);
  const [promoChecking, setPromoChecking] = useState(false);

  useEffect(() => {
    track('checkout_opened', { subtotal, itemCount: lines.length });
    // Prefill the contact number from the phone the user entered at sign-in
    // (if any) so most users don't retype it.
    if (sessionPhone) setContactPhone(sessionPhone);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // A usable contact number needs at least 8 digits (handles +20 / spaces).
  const phoneValid = contactPhone.replace(/\D/g, '').length >= 8;

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

  // Ask the backend what it will actually charge (zone rule + free-over
  // threshold) so the button total always matches place_order's math. Falls
  // back to the restaurant's flat fee while loading or on error.
  useEffect(() => {
    if (!restaurantId || !address) return;
    let cancelled = false;
    db.orders
      .quoteDeliveryFee(restaurantId, address.id, subtotal)
      .then((fee) => {
        if (!cancelled) setQuotedFee(fee);
      })
      .catch(() => {
        if (!cancelled) setQuotedFee(null);
      });
    return () => {
      cancelled = true;
    };
  }, [restaurantId, address, subtotal]);

  const deliveryFee = quotedFee ?? restaurant?.deliveryFeeEgp ?? 30;
  // Tax-inclusive at launch — mirrors place_order (v_tax := 0). The VAT row
  // stays hidden until the platform setting flips on.
  const tax: number = 0;
  const discount = promoApplied?.discount ?? 0;
  const total = Math.max(0, subtotal + deliveryFee + tax + tipEgp - discount);

  const applyPromo = async () => {
    const code = promoInput.trim();
    if (!code || promoChecking) return;
    setPromoChecking(true);
    setPromoError(false);
    try {
      const value = await db.orders.validatePromo(code, subtotal);
      if (value > 0) {
        success();
        setPromoApplied({ code: code.toUpperCase(), discount: value });
        track('promo_applied', { code: code.toUpperCase(), discount: value });
      } else {
        setPromoApplied(null);
        setPromoError(true);
        track('promo_rejected', { code: code.toUpperCase() });
      }
    } catch {
      setPromoApplied(null);
      setPromoError(true);
    } finally {
      setPromoChecking(false);
    }
  };

  const isCard = payment?.kind === 'card' || payment?.kind === 'apple_pay';

  const place = async () => {
    if (!restaurant || !address || !payment || lines.length === 0 || !phoneValid) return;
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
        taxRate: 0,
        kitchenNotes: kitchenNotes.trim() || undefined,
        dropoffPreference: dropoffPreference ?? undefined,
        dropoffNote: dropoffNote.trim() || undefined,
        aggregateAllergens: aggregateAllergens.length > 0 ? aggregateAllergens : undefined,
        scheduledFor: scheduledFor ?? undefined,
        promoCode: promoApplied?.code,
        customerPhone: contactPhone.trim(),
        idempotencyKey: idempotencyKey.current,
      });
      track('order_placed', {
        orderId: order.id,
        total: order.totalEgp,
        payment: payment.kind,
        scheduled: !!scheduledFor,
        promo: promoApplied?.code ?? null,
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
      captureError(e, { where: 'checkout.place' });
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
      <CheckoutStepper />

      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 200 }}>
        {/* Address card */}
        <View style={styles.card}>
          <View style={[styles.cardHead, dir.row]}>
            <Text style={styles.cardTitle}>{t('checkout.deliverTo')}</Text>
            <Pressable onPress={() => router.push('/address/picker')}>
              <Text style={styles.edit}>{t('checkout.change')}</Text>
            </Pressable>
          </View>
          {address ? (
            <View style={[styles.addr, dir.row]}>
              <View style={styles.pin}>
                <Icon name="location" size={18} color={colors.white} />
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
          ) : (
            // No saved address yet (typical for a brand-new tourist): give an
            // explicit add-address CTA instead of the inert "Choose an address"
            // text, so the disabled Place-order button is never the only signal.
            <Pressable
              onPress={() => router.push('/address/add')}
              accessibilityRole="button"
              accessibilityLabel={t('address.add')}
              style={[styles.addAddr, dir.row]}>
              <View style={styles.pin}>
                <Icon name="location" size={18} color={colors.white} />
              </View>
              <Text style={styles.addAddrText}>{t('address.add')}</Text>
              <Icon name="chevronForward" size={20} color={colors.ink3} />
            </Pressable>
          )}
        </View>

        <DropoffPreferenceCard
          addressKind={address?.kind}
          value={dropoffPreference}
          onChange={setDropoffPreference}
        />

        {/* Contact number — the driver calls this. Required to place the order. */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>{t('checkout.contactTitle')}</Text>
          <TextInput
            value={contactPhone}
            onChangeText={setContactPhone}
            placeholder={t('checkout.contactPlaceholder')}
            placeholderTextColor={colors.ink3}
            keyboardType="phone-pad"
            autoComplete="tel"
            textContentType="telephoneNumber"
            style={[styles.phoneInput, dir.text]}
            accessibilityLabel={t('checkout.contactTitle')}
          />
          <Text style={styles.phoneHint}>{t('checkout.contactHint')}</Text>
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
              style={[styles.timingChipAsap, scheduledFor === null && styles.timingChipActive]}>
              <Icon name="bolt" size={14} color={scheduledFor === null ? colors.white : colors.accent} />
              <Text style={[styles.timingChipText, scheduledFor === null && { color: colors.white }]}>
                {t('checkout.timingAsap')}
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
            <View style={styles.scheduledLineRow}>
              <Icon name="calendar" size={15} color={colors.sea} />
              <Text style={styles.scheduledLine}>
                {t('checkout.scheduledFor', { time: formatTime(new Date(scheduledFor)) })}
              </Text>
            </View>
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
          <View style={[styles.cardHead, dir.row]}>
            <Text style={styles.cardTitle}>{t('checkout.payWith')}</Text>
            {showCurrencyPicker && (
              <Pressable
                onPress={() => setCurrencyOpen((o) => !o)}
                accessibilityRole="button"
                accessibilityLabel={t('checkout.changeCurrency')}>
                <View style={styles.currencyChip}>
                  <Text style={styles.currencyText}>{currency}</Text>
                  <Icon name="transfer" size={13} color={colors.sea} />
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
          <Pressable
            onPress={() => router.push('/payment/picker')}
            accessibilityRole="button"
            accessibilityLabel={`${t('checkout.payWith')}: ${payment ? localizedPayment(t, payment).label : t('checkout.choosePayment')}`}
            style={styles.payChosen}>
            <View style={styles.payIcon}>
              <Icon name={paymentIconName(payment?.kind)} size={22} color={colors.ink} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.payLabel}>
                {payment ? localizedPayment(t, payment).label : t('checkout.choosePayment')}
              </Text>
              <Text style={styles.paySub}>{payment ? localizedPayment(t, payment).subline : ''}</Text>
            </View>
            <Icon name="chevronForward" size={20} color={colors.ink3} />
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

        {/* Promo code */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>{t('checkout.promoTitle')}</Text>
          {promoApplied ? (
            <View style={[styles.promoApplied, dir.row]}>
              <Text style={styles.promoAppliedText}>
                ✓ {promoApplied.code} · −{formatEgp(promoApplied.discount)}
              </Text>
              <Pressable
                onPress={() => {
                  selection();
                  setPromoApplied(null);
                  setPromoInput('');
                }}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel={t('checkout.promoRemove')}>
                <Text style={styles.promoRemove}>{t('checkout.promoRemove')}</Text>
              </Pressable>
            </View>
          ) : (
            <>
              <View style={[styles.promoRow, dir.row]}>
                <TextInput
                  value={promoInput}
                  onChangeText={(v) => {
                    setPromoInput(v);
                    setPromoError(false);
                  }}
                  placeholder={t('checkout.promoPlaceholder')}
                  placeholderTextColor={colors.ink3}
                  autoCapitalize="characters"
                  autoCorrect={false}
                  style={[styles.promoInput, dir.text]}
                  accessibilityLabel={t('checkout.promoTitle')}
                  onSubmitEditing={applyPromo}
                  returnKeyType="done"
                />
                <Pressable
                  onPress={applyPromo}
                  disabled={!promoInput.trim() || promoChecking}
                  accessibilityRole="button"
                  accessibilityLabel={t('checkout.promoApply')}
                  style={[
                    styles.promoBtn,
                    (!promoInput.trim() || promoChecking) && { opacity: 0.4 },
                  ]}>
                  <Text style={styles.promoBtnText}>
                    {promoChecking ? '…' : t('checkout.promoApply')}
                  </Text>
                </Pressable>
              </View>
              {promoError && <Text style={styles.promoErr}>{t('checkout.promoInvalid')}</Text>}
            </>
          )}
        </View>

        {/* Totals */}
        <View style={styles.card}>
          <View style={[styles.totRow, dir.row]}>
            <Text style={styles.totLabel}>{t('checkout.subtotal')}</Text>
            <Text style={styles.totVal}>{formatEgp(subtotal)}</Text>
          </View>
          <View style={[styles.totRow, dir.row]}>
            <Text style={styles.totLabel}>{t('checkout.delivery')}</Text>
            <Text style={[styles.totVal, deliveryFee === 0 && { color: colors.green }]}>
              {deliveryFee === 0 ? t('checkout.deliveryFree') : formatEgp(deliveryFee)}
            </Text>
          </View>
          {tax > 0 && (
            <View style={[styles.totRow, dir.row]}>
              <Text style={styles.totLabel}>{t('checkout.tax')}</Text>
              <Text style={styles.totVal}>{formatEgp(tax)}</Text>
            </View>
          )}
          {discount > 0 && (
            <View style={[styles.totRow, dir.row]}>
              <Text style={[styles.totLabel, { color: colors.green }]}>
                {t('checkout.discount', { code: promoApplied?.code ?? '' })}
              </Text>
              <Text style={[styles.totVal, { color: colors.green }]}>−{formatEgp(discount)}</Text>
            </View>
          )}
          {tipEgp > 0 && (
            <View style={[styles.totRow, dir.row]}>
              <Text style={styles.totLabel}>{t('checkout.tip')}</Text>
              <Text style={styles.totVal}>{formatEgp(tipEgp)}</Text>
            </View>
          )}
          <View style={[styles.totRow, styles.totTotal, dir.row]}>
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
        {/* Tell the customer why Place order is disabled when contact is missing. */}
        {address && payment && lines.length > 0 && !phoneValid && (
          <Text style={styles.cardHint}>{t('checkout.needPhone')}</Text>
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
          disabled={placing || !address || !payment || lines.length === 0 || !phoneValid}
        />
      </View>
    </View>
  );
}

function paymentIconName(kind?: PaymentMethod['kind']): IconName {
  switch (kind) {
    case 'cash':
      return 'cash';
    case 'vodafone_cash':
      return 'wallet';
    case 'instapay':
      return 'transfer';
    case 'fawry':
      return 'receipt';
    case 'card':
    case 'apple_pay':
      return 'card';
    default:
      return 'chevronForward';
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
  addAddr: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: radius.lg,
    backgroundColor: colors.bgSoft,
  },
  addAddrText: { flex: 1, fontSize: font.sizes.xl, color: colors.ink, fontWeight: font.weights.bold },
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
  currencyChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: colors.seaSoft,
    borderRadius: radius.pill,
    paddingHorizontal: 12,
    paddingVertical: 5,
  },
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
  payIcon: { width: 28, alignItems: 'center' },
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
  timingChipAsap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: radius.pill,
    backgroundColor: colors.bgSoft,
    borderWidth: 1,
    borderColor: colors.line,
  },
  timingChipActive: { backgroundColor: colors.ink, borderColor: colors.ink },
  timingChipText: { fontSize: font.sizes.lg, color: colors.ink, fontWeight: font.weights.bold },
  scheduledLineRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 10 },
  scheduledLine: {
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
  promoRow: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  promoInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.lg,
    backgroundColor: colors.bgSoft,
    paddingHorizontal: 12,
    height: 44,
    fontSize: font.sizes.lg,
    color: colors.ink,
  },
  phoneInput: {
    marginTop: 10,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.lg,
    backgroundColor: colors.bgSoft,
    paddingHorizontal: 12,
    height: 46,
    fontSize: font.sizes.lg,
    color: colors.ink,
  },
  phoneHint: { marginTop: 8, fontSize: font.sizes.sm, color: colors.ink3 },
  promoBtn: {
    paddingHorizontal: 16,
    height: 44,
    borderRadius: radius.lg,
    backgroundColor: colors.ink,
    alignItems: 'center',
    justifyContent: 'center',
  },
  promoBtnText: { color: colors.white, fontSize: font.sizes.lg, fontWeight: font.weights.bold },
  promoErr: { marginTop: 8, color: colors.red, fontSize: font.sizes.md },
  promoApplied: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#eef9f1',
    borderWidth: 1,
    borderColor: colors.green,
    borderRadius: radius.lg,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  promoAppliedText: { color: colors.green, fontSize: font.sizes.lg, fontWeight: font.weights.bold },
  promoRemove: { color: colors.ink2, fontSize: font.sizes.md, fontWeight: font.weights.semibold },
});
