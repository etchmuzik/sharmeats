/**
 * One ticket in the kitchen queue.
 *
 * The governing constraint ([H-REST3]): merchants miss roughly two thirds of
 * orders into the auto-accept timeout. A missed chime is a late kitchen. So an
 * unaccepted ticket does not sit still and wait to be noticed — it ages
 * visibly:
 *
 *   0–60s    calm      normal card
 *   60–120s  warning   amber border, "Waiting 1:14" timer
 *   120s+    critical  red border, pulsing, "Accept now" on the button
 *
 * Colour never carries this alone — the wait timer is text, and the button
 * label itself changes. Kitchen tablets are viewed through steam and grease at
 * an angle, and hue is the first thing that degrades.
 *
 * These thresholds are deliberately NOT tied to the server's auto-accept
 * window. `platform_settings.auto_accept_enabled` defaults to false (mig 026)
 * and auto-accept only ever covers COD orders, so a card order — or any order
 * on a platform with the setting off — can sit at 'placed' indefinitely. The
 * escalation therefore expresses "a human has kept a customer waiting this
 * long", which is true regardless of whether a safety net exists.
 *
 * Consequence, by design: a ticket nobody ever accepts keeps its timer running
 * and stays in the critical state. It does not time out into calm, because
 * nothing about it has actually got better. If an unattended kiosk pulsing
 * indefinitely proves worse than a stale ticket going quiet, cap the escalation
 * here rather than in the parent screen.
 *
 * Everything below the header (allergens, items, per-item notes, address,
 * contact) is unchanged in behaviour from the original inline implementation.
 */
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, Text, TextInput, View } from 'react-native';
import Animated from 'react-native-reanimated';
import type { OrderStatus, RestaurantOrder } from '../orders';
import { colors, font, radius, spacing } from '../theme';
import { Icon } from './Icon';
import { AllergenBanner } from './AllergenBanner';
import { ContactButtons } from './ContactButtons';
import { cardEnter, cardExit, listReflow, usePulse } from './motion';
import { notifyWarning, tapHeavy, tapLight } from '../lib/haptics';
import { useLocale } from '../locale';
import type { TranslationKey, TranslationParams } from '../i18n';

/** Seconds an unaccepted ticket may wait before it reads as a warning. */
const WARN_AFTER_S = 60;
/** Seconds after which an unaccepted ticket is critical (auto-accept looms). */
const CRITICAL_AFTER_S = 120;

type Waiting = 'calm' | 'warning' | 'critical';

/**
 * Seconds this ticket has been waiting, ticking once per second. Only runs for
 * unaccepted ('placed') tickets — an accepted ticket has been seen by a human,
 * so there is nothing left to escalate and no reason to keep a timer alive.
 */
function useWaitSeconds(placedAt: string, active: boolean): number {
  // A malformed timestamp yields NaN, and `NaN >= 120` / `NaN >= 60` are both
  // false — so escalation would silently stay 'calm' forever: no amber, no red,
  // no timer, no haptic. That fails OPEN on the exact mechanism built to stop
  // merchants missing orders, and it fails invisibly. Treat an unparseable
  // placed_at as "waiting since now" (0s) so the ticket still ages normally.
  const compute = () => {
    const placedMs = new Date(placedAt).getTime();
    if (Number.isNaN(placedMs)) return 0;
    return Math.max(0, Math.round((Date.now() - placedMs) / 1000));
  };
  const [seconds, setSeconds] = useState(compute);

  useEffect(() => {
    if (!active) return;
    setSeconds(compute());
    const id = setInterval(() => setSeconds(compute()), 1000);
    return () => clearInterval(id);
  }, [placedAt, active]);

  return seconds;
}

function waitingOf(seconds: number, active: boolean): Waiting {
  if (!active) return 'calm';
  if (seconds >= CRITICAL_AFTER_S) return 'critical';
  if (seconds >= WARN_AFTER_S) return 'warning';
  return 'calm';
}

/** Format seconds as m:ss for the wait timer. */
function formatWait(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

type Translate = (key: TranslationKey, params?: TranslationParams) => string;

function addressLine(order: RestaurantOrder, t: Translate): string {
  const addr = order.address_snapshot;
  if (addr?.kind === 'hotel') {
    return `${addr.hotelName ?? t('order.hotel')} · ${t('order.room')} ${
      addr.roomNumber ?? t('order.roomNotProvided')
    }`;
  }
  if (addr?.kind === 'street') {
    return `${addr.streetText ?? ''} ${addr.building ?? ''}`.trim() || t('order.address');
  }
  if (addr?.kind === 'beach_pin') {
    return `${t('order.beach')} · ${addr.beachName ?? ''}`;
  }
  return addr?.label ?? t('order.address');
}

type Props = {
  order: RestaurantOrder;
  busy: boolean;
  /** Short brand tag ("SMASH") — only rendered in multi-brand kitchens. Text is
   *  the primary signal: colour alone fails on greasy, glare-washed tablets. */
  brandTag?: string;
  onOpenDetail?: () => void;
  onAccept?: () => void;
  onReject?: (reason?: string) => void;
  primary?: { label: string; next: OrderStatus };
  onPrimary?: (next: OrderStatus) => void;
  /** True when the kiosk chime is muted — suppresses the escalation haptic too. */
  muted?: boolean;
  /**
   * Parent-owned set of order ids that have already fired their critical haptic.
   * Lives above this component so it survives SectionList unmounting rows that
   * scroll out of the render window. Mutated in place; never read during render.
   */
  warnedIds: Set<string>;
};

export function OrderRow({
  order,
  busy,
  brandTag,
  onOpenDetail,
  onAccept,
  onReject,
  primary,
  onPrimary,
  muted = false,
  warnedIds,
}: Props) {
  const { direction, isRtl, t } = useLocale();
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');
  const paymentStatus = t(`payment.status.${order.payment_status}`);
  const paymentA11y =
    order.payment_method === 'cash_on_delivery'
      ? t('payment.cash')
      : t('payment.card', { status: paymentStatus });

  // Only unaccepted tickets escalate.
  const unacked = order.status === 'placed';
  const waitSeconds = useWaitSeconds(order.placed_at, unacked);
  const waiting = waitingOf(waitSeconds, unacked);
  const pulseStyle = usePulse(waiting === 'critical');

  // One warning haptic when a ticket first turns critical.
  //
  // The "already warned" set is owned by the PARENT, not this component: a
  // SectionList unmounts rows that scroll out of its render window, and a
  // component-local ref would reset on remount — so scrolling a long-waiting
  // ticket off screen and back would buzz again, and again, for a ticket that
  // is not new. Keyed by order id, the set survives recycling.
  //
  // Also honours the kiosk mute toggle. A muted counter means "stop alerting
  // me"; a silent buzz is still an alert, and with several tickets crossing the
  // threshold together the tablet would rattle continuously.
  useEffect(() => {
    if (waiting !== 'critical' || muted) return;
    if (warnedIds.has(order.id)) return;
    warnedIds.add(order.id);
    notifyWarning();
  }, [waiting, muted, order.id, warnedIds]);

  const borderColor =
    waiting === 'critical' ? colors.red : waiting === 'warning' ? colors.amber : colors.line;
  // Text weight, not border weight — see the *Text token comments in theme.ts.
  const waitColor = waiting === 'critical' ? colors.redText : colors.amberText;

  return (
    <Animated.View
      entering={cardEnter}
      exiting={cardExit}
      layout={listReflow}
      style={[
        {
          borderWidth: waiting === 'calm' ? 1 : 2,
          borderColor,
          borderRadius: radius.xl,
          borderCurve: 'continuous',
          backgroundColor: colors.white,
          padding: spacing.lg,
          gap: spacing.sm,
          direction,
          boxShadow:
            waiting === 'critical'
              ? '0 4px 16px rgba(200, 65, 42, 0.18)'
              : '0 1px 3px rgba(10, 10, 12, 0.06)',
        },
        pulseStyle,
      ]}
    >
      <Pressable
        onPress={() => {
          if (!onOpenDetail) return;
          tapLight();
          onOpenDetail();
        }}
        disabled={!onOpenDetail}
        accessibilityRole={onOpenDetail ? 'button' : undefined}
        // React Native flattens the subtree of an element carrying an
        // accessibilityLabel, so a bare "Open order A4F2" would SWALLOW the
        // total and payment method — and whether a ticket is cash-on-delivery
        // changes how the handover is run. Fold them into the label.
        accessibilityLabel={
          onOpenDetail
            ? t('order.openA11y', {
                code: order.short_code,
                amount: order.total_egp,
                payment: paymentA11y,
              })
            : undefined
        }
        style={{
          flexDirection: 'row',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          // Without this the row is only as tall as its text (~36-40pt) and it
          // is the sole route into the order detail. 48pt for gloved hands.
          minHeight: onOpenDetail ? 48 : undefined,
        }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flex: 1, minWidth: 0 }}>
          {brandTag ? (
            <View
              accessibilityLabel={t('order.brandA11y', { brand: brandTag })}
              style={{
                backgroundColor: colors.accentSoft,
                borderRadius: radius.sm,
                paddingHorizontal: 6,
                paddingVertical: 2,
                alignSelf: 'flex-start',
              }}
            >
              <Text style={{ fontSize: font.sizes.xs, fontWeight: '800', color: colors.accentDark }}>
                {brandTag}
              </Text>
            </View>
          ) : null}
          <View style={{ flexShrink: 1 }}>
            <Text
              selectable
              style={{
                fontWeight: '800',
                fontSize: font.sizes.lg,
                color: colors.ink,
                writingDirection: 'ltr',
              }}
            >
              {order.short_code}
            </Text>
            <Text
              style={{
                fontSize: font.sizes.xs,
                color: colors.ink3,
                writingDirection: isRtl ? 'rtl' : 'ltr',
              }}
            >
              {new Date(order.placed_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              {order.scheduled_for
                ? ` · ${t('order.scheduled', {
                    time: new Date(order.scheduled_for).toLocaleTimeString([], {
                      hour: '2-digit',
                      minute: '2-digit',
                    }),
                  })}`
                : ''}
            </Text>
          </View>
          {onOpenDetail ? <Icon name="chevronForward" size={16} color={colors.ink3} /> : null}
        </View>
        <View style={{ alignItems: 'flex-end' }}>
          <Text
            selectable
            style={{
              fontWeight: '800',
              fontSize: font.sizes.lg,
              color: colors.ink,
              fontVariant: ['tabular-nums'],
              writingDirection: 'ltr',
            }}
          >
            {order.total_egp} EGP
          </Text>
          <Text
            style={{
              fontSize: font.sizes.xs,
              fontWeight: '700',
              color:
                order.payment_method === 'cash_on_delivery'
                  ? colors.sea
                  : order.payment_status === 'paid'
                    ? colors.greenText
                    : colors.amberText,
            }}
          >
            {order.payment_method === 'cash_on_delivery'
              ? t('payment.cashLabel')
              : t('payment.cardLabel', { status: paymentStatus })}
          </Text>
        </View>
      </Pressable>

      {/* [H-REST3] Live wait timer on an unaccepted ticket. Text, not just hue. */}
      {unacked && waiting !== 'calm' && (
        <View
          accessibilityRole="text"
          accessibilityLabel={t('order.waitingA11y', { time: formatWait(waitSeconds) })}
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 6,
            alignSelf: 'flex-start',
            backgroundColor: waiting === 'critical' ? colors.redSoft : colors.amberSoft,
            borderRadius: radius.pill,
            paddingHorizontal: spacing.md,
            paddingVertical: 4,
          }}
        >
          <Icon name="clock" size={13} color={waitColor} />
          <Text
            style={{
              color: waitColor,
              fontWeight: '800',
              fontSize: font.sizes.sm,
              fontVariant: ['tabular-nums'],
            }}
          >
            {t('order.waiting', { time: formatWait(waitSeconds) })}
          </Text>
        </View>
      )}

      {/* [H-REST2] Food-safety allergy briefing — must be prominent. */}
      <AllergenBanner allergens={order.aggregate_allergens} />

      {/* Items */}
      <View style={{ gap: 2 }}>
        {order.items?.map((it, i) => (
          <View key={i}>
            <Text selectable style={{ fontSize: font.sizes.base, color: colors.ink }}>
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
              <Text selectable style={{ fontSize: font.sizes.sm, color: colors.amberText, marginStart: spacing.md }}>
                “{it.notes}”
              </Text>
            ) : null}
          </View>
        ))}
      </View>

      {order.kitchen_notes ? (
        <View
          style={{
            backgroundColor: colors.amberSoft,
            borderRadius: radius.md,
            borderCurve: 'continuous',
            paddingHorizontal: spacing.md,
            paddingVertical: spacing.sm,
          }}
        >
          <Text selectable style={{ fontSize: font.sizes.xs, color: colors.amberText }}>
            {t('order.kitchenNoteInline', { note: order.kitchen_notes })}
          </Text>
        </View>
      ) : null}

      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 6,
          borderTopWidth: 1,
          borderTopColor: colors.line,
          paddingTop: spacing.sm,
        }}
      >
        <Icon name="location" size={13} color={colors.ink3} />
        <Text selectable style={{ flex: 1, flexShrink: 1, fontSize: font.sizes.xs, color: colors.ink2 }}>
          {addressLine(order, t)}
        </Text>
        <View style={{ borderRadius: radius.sm, backgroundColor: colors.sand, paddingHorizontal: 6, paddingVertical: 2 }}>
          <Text style={{ fontSize: font.sizes.xs, textTransform: isRtl ? 'none' : 'uppercase', color: colors.ink2 }}>
            {order.fulfillment_type === 'self_delivery'
              ? t('fulfillment.self')
              : t('fulfillment.platform')}
          </Text>
        </View>
      </View>

      {/* [H-REST2] Contact — call the customer or open the in-app chat. */}
      <ContactButtons orderId={order.id} customerPhone={order.customer_phone} />

      {/* Actions */}
      {rejecting && onReject ? (
        <View
          style={{
            borderWidth: 1,
            borderColor: colors.red,
            backgroundColor: colors.redSoft,
            borderRadius: radius.lg,
            borderCurve: 'continuous',
            padding: spacing.md,
            gap: spacing.sm,
          }}
        >
          <Text style={{ fontSize: font.sizes.xs, fontWeight: '700', color: colors.red }}>
            {t('order.rejectReason')}
          </Text>
          <TextInput
            autoFocus
            value={reason}
            onChangeText={setReason}
            placeholder={t('order.rejectPlaceholder')}
            placeholderTextColor={colors.ink3}
            accessibilityLabel={t('order.rejectReasonA11y')}
            style={{
              borderWidth: 1,
              borderColor: colors.line,
              borderRadius: radius.md,
              paddingHorizontal: spacing.md,
              paddingVertical: spacing.sm,
              backgroundColor: colors.white,
              color: colors.ink,
              textAlign: isRtl ? 'right' : 'left',
              writingDirection: direction,
            }}
          />
          <View style={{ flexDirection: 'row', gap: spacing.sm }}>
            <Pressable
              onPress={() => {
                tapLight();
                setRejecting(false);
                setReason('');
              }}
              accessibilityRole="button"
              accessibilityLabel={t('order.cancelRejectionA11y')}
              style={{
                flex: 1,
                minHeight: 48,
                borderWidth: 1,
                borderColor: colors.line,
                borderRadius: radius.md,
                borderCurve: 'continuous',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Text style={{ fontSize: font.sizes.sm, fontWeight: '700', color: colors.ink2 }}>
                {t('order.cancel')}
              </Text>
            </Pressable>
            <Pressable
              onPress={() => {
                tapHeavy();
                onReject(reason.trim() || undefined);
              }}
              accessibilityRole="button"
              accessibilityLabel={t('order.confirmRejectionA11y')}
              style={{
                flex: 1,
                minHeight: 48,
                backgroundColor: colors.red,
                borderRadius: radius.md,
                borderCurve: 'continuous',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Text style={{ fontSize: font.sizes.sm, fontWeight: '700', color: colors.white }}>
                {t('order.confirmReject')}
              </Text>
            </Pressable>
          </View>
        </View>
      ) : onAccept || onReject || primary ? (
        <View style={{ flexDirection: 'row', gap: spacing.sm }}>
          {onReject && (
            <Pressable
              onPress={() => {
                tapLight();
                setRejecting(true);
              }}
              disabled={busy}
              accessibilityRole="button"
              accessibilityLabel={t('order.rejectA11y', { code: order.short_code })}
              accessibilityState={{ disabled: busy, busy }}
              style={{
                flex: 1,
                minHeight: 52,
                borderWidth: 1,
                borderColor: colors.line,
                borderRadius: radius.lg,
                borderCurve: 'continuous',
                alignItems: 'center',
                justifyContent: 'center',
                opacity: busy ? 0.5 : 1,
              }}
            >
              <Text style={{ fontSize: font.sizes.base, fontWeight: '700', color: colors.red }}>
                {t('order.reject')}
              </Text>
            </Pressable>
          )}
          {onAccept && (
            /* Accept is weighted 2:1 over Reject — the safe, overwhelmingly
               common action gets the bigger target on a tablet operated with
               wet or gloved hands. */
            <Pressable
              onPress={() => {
                tapHeavy();
                onAccept();
              }}
              disabled={busy}
              accessibilityRole="button"
              accessibilityLabel={t('order.acceptA11y', { code: order.short_code })}
              accessibilityState={{ disabled: busy, busy }}
              style={{
                flex: 2,
                minHeight: 52,
                backgroundColor: colors.green,
                borderRadius: radius.lg,
                borderCurve: 'continuous',
                alignItems: 'center',
                justifyContent: 'center',
                opacity: busy ? 0.6 : 1,
              }}
            >
              {busy ? (
                <ActivityIndicator color={colors.white} />
              ) : (
                <Text style={{ fontSize: font.sizes.lg, fontWeight: '800', color: colors.white }}>
                  {waiting === 'critical' ? t('order.acceptNow') : t('order.accept')}
                </Text>
              )}
            </Pressable>
          )}
          {primary && onPrimary && (
            <Pressable
              onPress={() => {
                tapHeavy();
                onPrimary(primary.next);
              }}
              disabled={busy}
              accessibilityRole="button"
              accessibilityLabel={t('order.actionA11y', {
                action: primary.label,
                code: order.short_code,
              })}
              accessibilityState={{ disabled: busy, busy }}
              style={{
                flex: 1,
                minHeight: 52,
                backgroundColor: colors.accent,
                borderRadius: radius.lg,
                borderCurve: 'continuous',
                alignItems: 'center',
                justifyContent: 'center',
                opacity: busy ? 0.6 : 1,
              }}
            >
              {busy ? (
                <ActivityIndicator color={colors.white} />
              ) : (
                <Text style={{ fontSize: font.sizes.base, fontWeight: '700', color: colors.white }}>
                  {primary.label}
                </Text>
              )}
            </Pressable>
          )}
        </View>
      ) : null}
    </Animated.View>
  );
}
