/**
 * A pending delivery offer — the highest-stakes surface in the driver app.
 *
 * Context drives every decision here: a driver has ~60 seconds to decide, often
 * one-handed, outdoors, in direct sun, sometimes wearing a helmet. So:
 *
 * - The countdown is a full-width BAR, not a small pill. Bar length is readable
 *   peripherally; four-point type is not.
 * - Urgency escalates in three stages (calm → warning → critical) using colour
 *   AND text AND motion, never colour alone — glare washes out hue first.
 * - Accept is twice the width of Decline. Both are still 48pt+, but a mis-tap on
 *   a 50/50 split costs the driver a paid job, so the safer target is bigger.
 * - Haptics fire on decision and once when the offer turns critical, because a
 *   phone in a jacket pocket is felt long before it is seen.
 *
 * The customer address and phone are intentionally NOT shown pre-accept
 * ([H-DRV2]) — only the drop-off zone.
 */
import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Pressable, Text, View } from 'react-native';
import Animated from 'react-native-reanimated';
import type { Assignment } from '../jobs';
import {
  CRITICAL_S,
  FALLBACK_WINDOW_S,
  type Urgency,
  barFraction,
  formatCountdown,
  isExpired,
  nextOfferWindow,
  parseExpiry,
  secondsRemaining,
  urgencyOf,
} from '../offerUrgency';
import { font, radius, spacing, type Palette } from '../theme';
import { useThemeColors } from '../themeProvider';
import { Icon } from './Icon';
import { cardEnter, cardExit, listReflow, useCountdownBar, usePulse } from './motion';
import { notifyWarning, tapHeavy, tapLight } from '../lib/haptics';
import { useI18n } from '../i18n-context';

// Escalation thresholds, timestamp parsing and bar scaling live in
// `../offerUrgency` so they can be unit-tested without rendering — see
// offerUrgency.test.ts, which covers the malformed-expiry and window-scaling
// regressions this component previously had.

/**
 * Palette per urgency stage. Text/label always carries the meaning too.
 *
 * Takes the active palette rather than importing it: as a module-scope function
 * it would otherwise capture the light palette permanently.
 */
function paletteOf(urgency: Urgency, colors: Palette) {
  // `fg` is text/icon weight and `border` is border weight — deliberately
  // different tokens for the same semantic colour. See theme.ts: the border
  // values fail AA as small text, and this chip is read in direct sun.
  switch (urgency) {
    case 'critical':
      return { fg: colors.redText, bg: colors.redSoft, border: colors.red };
    case 'warning':
      return { fg: colors.amberText, bg: colors.amberSoft, border: colors.amber };
    default:
      return { fg: colors.accentDark, bg: colors.accentSoft, border: colors.accent };
  }
}

/**
 * Live seconds-remaining until `expiresAt`, ticking once per second. Returns
 * null when there's no expiry timestamp (legacy rows). Clamps at 0. Fires
 * `onZero` exactly once, the first tick that reaches 0, so the parent can drop
 * the offer without fighting the server (dispatch_sweep already expired it).
 */
function useCountdown(expiresAt: string | null, onZero: () => void): number | null {
  // parseExpiry collapses an unparseable timestamp to null (see offerUrgency.ts)
  // so the null-handling below — which fails CLOSED — covers it.
  const targetMs = parseExpiry(expiresAt);
  const [seconds, setSeconds] = useState<number | null>(() =>
    secondsRemaining(targetMs, Date.now()),
  );
  const firedRef = useRef(false);

  useEffect(() => {
    if (targetMs === null) {
      setSeconds(null);
      return;
    }
    firedRef.current = false;
    setSeconds(secondsRemaining(targetMs, Date.now()));
    const id = setInterval(() => {
      const remaining = secondsRemaining(targetMs, Date.now());
      setSeconds(remaining);
      if (remaining !== null && remaining <= 0 && !firedRef.current) {
        firedRef.current = true;
        onZero();
      }
    }, 1000);
    return () => clearInterval(id);
    // Re-arm only when the expiry instant changes; onZero is a fresh closure each
    // render but the firedRef guard makes re-runs harmless.
  }, [targetMs]);

  return seconds;
}

/**
 * The window this particular offer is being measured against, for scaling the
 * countdown bar only.
 *
 * Calibrates from the offer rather than from a constant: the largest
 * seconds-remaining ever seen for this card is, by definition, at least the real
 * window. A card mounted at the instant of the offer sees the true TTL; one
 * mounted late sees less and the bar simply starts partly drained — which is
 * honest, because time really has already elapsed.
 *
 * The ratchet only ever grows, so the bar never jumps backwards mid-countdown.
 */
function useOfferWindow(seconds: number | null): number {
  const windowRef = useRef(FALLBACK_WINDOW_S);
  windowRef.current = nextOfferWindow(windowRef.current, seconds);
  return windowRef.current;
}

function formatZone(zone: string): string {
  return zone
    .split('_')
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

type Props = {
  offer: Assignment;
  onAccept: () => void;
  onDecline: () => void;
  onExpire: () => void;
  // True while a response (accept or decline) for THIS offer is in flight, so
  // both buttons lock — a double-tap, or tapping Decline after Accept, would
  // otherwise fire a second driver_respond that rejects and toasts a spurious
  // failure for a job the driver actually won.
  responding?: boolean;
};

export function OfferCard({ offer, onAccept, onDecline, onExpire, responding = false }: Props) {
  const colors = useThemeColors();
  const { direction, t } = useI18n();
  const seconds = useCountdown(offer.offer_expires_at, onExpire);
  const payout = offer.delivery_fee_egp + offer.tip_egp;
  const urgency = urgencyOf(seconds);
  const expired = isExpired(seconds);
  const palette = paletteOf(urgency, colors);

  // Pulse only while critical AND not yet expired — an expired card should go
  // still, not keep demanding attention it can no longer act on.
  const pulseStyle = usePulse(urgency === 'critical' && !expired);
  const offerWindow = useOfferWindow(seconds);
  const barStyle = useCountdownBar(barFraction(seconds, offerWindow));

  // One warning haptic the moment the offer turns critical. Ref-guarded so it
  // fires once per card, not once per second for the last ten seconds.
  const warnedRef = useRef(false);
  useEffect(() => {
    if (urgency === 'critical' && !expired && !warnedRef.current) {
      warnedRef.current = true;
      notifyWarning();
      // Everything else that marks "critical" — border, shadow, pulse — is
      // purely visual, and a haptic alone is undifferentiated: it cannot say
      // WHICH offer, or what changed. Without this a driver using TalkBack has
      // no way to know an offer is seconds from expiring; the card reads
      // identically at 60s and at 3s, and the Accept label only changes once
      // the job is already lost.
      AccessibilityInfo.announceForAccessibility(
        t('offer.criticalAnnouncement', {
          restaurant: offer.restaurant_name,
          seconds: CRITICAL_S,
        }),
      );
    }
  }, [urgency, expired, offer.restaurant_name, t]);

  const countdownLabel = expired
    ? t('offer.expired')
    : seconds === null
      ? null
      : formatCountdown(seconds);

  return (
    <Animated.View
      entering={cardEnter}
      exiting={cardExit}
      layout={listReflow}
      style={[
        {
          backgroundColor: colors.surface,
          borderWidth: urgency === 'calm' ? 1 : 2,
          borderColor: palette.border,
          borderRadius: radius.xl,
          borderCurve: 'continuous',
          padding: spacing.lg,
          marginBottom: spacing.md,
          gap: spacing.sm,
          direction: direction.direction,
          boxShadow:
            urgency === 'critical'
              ? '0 4px 16px rgba(200, 65, 42, 0.18)'
              : '0 1px 3px rgba(10, 10, 12, 0.06)',
          opacity: expired ? 0.6 : 1,
        },
        pulseStyle,
      ]}
    >
      {/* Countdown bar — the primary urgency signal. */}
      {seconds !== null && (
        <View
          // Hidden from the a11y tree, not labelled: as the card's first child
          // it would otherwise announce the deadline BEFORE the driver knows
          // what the job is — and a static View's label is captured at focus
          // time, so the figure it read out would already be stale. The
          // countdown chip below carries the same information in reading order,
          // and announceForAccessibility handles the critical transition.
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={{
            height: 6,
            borderRadius: radius.pill,
            backgroundColor: colors.line,
            overflow: 'hidden',
          }}
        >
          <Animated.View
            style={[{ height: '100%', borderRadius: radius.pill, backgroundColor: palette.fg }, barStyle]}
          />
        </View>
      )}

      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: font.sizes.xs, fontWeight: '700', color: colors.ink2, textTransform: 'uppercase' }}>
            {t('offer.pickup')}
          </Text>
          <Text selectable style={{ fontWeight: '700', color: colors.ink, fontSize: font.sizes.lg, marginTop: 2 }}>
            {offer.restaurant_name}
          </Text>
        </View>
        {countdownLabel !== null && (
          <View
            accessibilityRole="text"
            accessibilityLabel={
              expired
                ? t('offer.expiredA11y')
                : t('offer.expiresIn', { time: countdownLabel })
            }
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 4,
              backgroundColor: palette.bg,
              borderRadius: radius.lg,
              borderCurve: 'continuous',
              paddingHorizontal: spacing.md,
              paddingVertical: 4,
            }}
          >
            <Icon name="clock" size={13} color={palette.fg} />
            <Text
              style={{
                color: palette.fg,
                fontWeight: '700',
                fontSize: font.sizes.sm,
                fontVariant: ['tabular-nums'],
              }}
            >
              {countdownLabel}
            </Text>
          </View>
        )}
      </View>

      {/* greenText: the payout is the figure a driver decides on, and the fill
          value sits at 4.21:1 on the card — under the small-text floor. */}
      <Text selectable style={{ color: colors.greenText, fontSize: font.sizes.xl, fontWeight: '800' }}>
        {t('offer.earn', { amount: payout })}
      </Text>

      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
        <Icon name="navigate" size={16} color={colors.accentDark} />
        <Text style={{ flex: 1, color: colors.ink2, fontSize: font.sizes.sm, textAlign: direction.textAlign }}>
          {offer.dropoff_zone
            ? t('offer.dropoffArea', { zone: formatZone(offer.dropoff_zone) })
            : t('offer.dropoffPending')}
        </Text>
      </View>
      <Text style={{ color: colors.ink3, fontSize: font.sizes.xs }}>
        {t('offer.unlock')}
      </Text>

      {/* Accept is weighted 2:1 — a mis-tap here costs the driver a paid job.
          Both lock the moment a response is in flight (responding) as well as on
          expiry, so a double-tap cannot fire a second driver_respond. */}
      <View style={{ flexDirection: 'row', gap: spacing.md, marginTop: spacing.xs }}>
        <Pressable
          onPress={() => {
            tapLight();
            onDecline();
          }}
          disabled={expired || responding}
          accessibilityRole="button"
          accessibilityLabel={t('offer.declineA11y', {
            restaurant: offer.restaurant_name,
          })}
          accessibilityState={{ disabled: expired || responding }}
          style={({ pressed }) => ({
            flex: 1,
            minHeight: 52,
            borderWidth: 1,
            borderColor: colors.line,
            borderRadius: radius.lg,
            borderCurve: 'continuous',
            alignItems: 'center',
            justifyContent: 'center',
            opacity: responding ? 0.4 : pressed ? 0.6 : 1,
          })}
        >
          <Text style={{ color: colors.redText, fontWeight: '600' }}>{t('offer.decline')}</Text>
        </Pressable>
        <Pressable
          onPress={() => {
            tapHeavy();
            onAccept();
          }}
          disabled={expired || responding}
          accessibilityRole="button"
          accessibilityLabel={t('offer.acceptA11y', {
            restaurant: offer.restaurant_name,
            amount: payout,
          })}
          accessibilityState={{ disabled: expired || responding }}
          style={({ pressed }) => ({
            flex: 2,
            minHeight: 52,
            backgroundColor: expired ? colors.ink3 : colors.green,
            borderRadius: radius.lg,
            borderCurve: 'continuous',
            alignItems: 'center',
            justifyContent: 'center',
            opacity: responding ? 0.6 : pressed ? 0.85 : 1,
          })}
        >
          {/* onInk, not white: BOTH fills behind this label invert with the
              theme — green and ink3 are dark in light and light in dark. A
              white label scored 2.27:1 on the dark green Accept button, the
              single most important control in this app. */}
          <Text style={{ color: colors.onInk, fontWeight: '800', fontSize: font.sizes.lg }}>
            {expired ? t('offer.expired') : t('offer.accept')}
          </Text>
        </Pressable>
      </View>
    </Animated.View>
  );
}
