import { useEffect, useState } from 'react';
import { AppState, StyleSheet, Text, View } from 'react-native';
import { colors, font, radius, spacing } from '../theme';

/**
 * Phase-aware delivery countdown shown on the active-job screen once a driver
 * has accepted an order.
 *
 * - BEFORE pickup (accepted/preparing/ready): counts down to a derived pickup
 *   deadline (the promised delivery ETA minus a travel buffer), labelled
 *   "Pick up by".
 * - AFTER pickup (picked_up/out_for_delivery): counts down to the promised
 *   delivery time (orders.eta_at, the honest ETA from mig 079), labelled
 *   "Deliver by" — the same clock the customer sees.
 *
 * The target times are REAL timestamps off the order, never invented — so the
 * countdown can't promise something the rest of the system contradicts. Colour
 * escalates calm → amber (≤5 min) → red (overdue).
 */

interface Props {
  /** Promised delivery time (orders.eta_at) as ISO string, or null if unknown. */
  etaAt: string | null;
  /** True while still heading to the restaurant (before pickup). */
  beforePickup: boolean;
  /**
   * Minutes to reserve for the drop-off leg when deriving the pickup deadline.
   * Pickup should happen at least this long before the delivery ETA. Default 20.
   */
  dropoffBufferMin?: number;
}

/** mm:ss (or -mm:ss when overdue) from a signed millisecond delta. */
function formatDelta(ms: number): string {
  const overdue = ms < 0;
  const totalSec = Math.floor(Math.abs(ms) / 1000);
  const mm = Math.floor(totalSec / 60);
  const ss = totalSec % 60;
  const body = `${mm}:${ss.toString().padStart(2, '0')}`;
  return overdue ? `-${body}` : body;
}

export function DeliveryCountdown({ etaAt, beforePickup, dropoffBufferMin = 20 }: Props) {
  // Re-render every second. Seeded once; the interval drives the tick. We also
  // resync on app-foreground because JS timers are throttled/paused in the
  // background, so the displayed value could otherwise be stale on return.
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') setNow(Date.now());
    });
    return () => {
      clearInterval(id);
      sub.remove();
    };
  }, []);

  // No honest ETA on the order → don't fabricate a clock; render nothing.
  if (!etaAt) return null;
  const etaMs = new Date(etaAt).getTime();
  if (!Number.isFinite(etaMs)) return null;

  // Target: delivery ETA after pickup; a travel-buffered pickup deadline before.
  const targetMs = beforePickup ? etaMs - dropoffBufferMin * 60_000 : etaMs;
  const remaining = targetMs - now;

  const overdue = remaining < 0;
  const urgent = !overdue && remaining <= 5 * 60_000;
  const bg = overdue ? colors.redSoft : urgent ? colors.amberSoft : colors.accentSoft;
  const fg = overdue ? colors.red : urgent ? colors.amber : colors.accentDark;

  const label = beforePickup ? 'Pick up by' : 'Deliver by';
  const clockLabel = overdue ? (beforePickup ? 'Pickup overdue' : 'Delivery overdue') : label;

  return (
    <View style={[styles.wrap, { backgroundColor: bg }]} accessibilityRole="timer">
      <Text style={[styles.label, { color: fg }]}>{clockLabel.toUpperCase()}</Text>
      <Text
        style={[styles.time, { color: fg }]}
        accessibilityLabel={`${clockLabel}, ${formatDelta(remaining)}`}
      >
        {formatDelta(remaining)}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    marginTop: spacing.md,
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.xl,
  },
  label: { fontSize: font.sizes.xs, fontWeight: '800', letterSpacing: 0.5 },
  time: { fontSize: font.sizes.xl, fontWeight: '800', fontVariant: ['tabular-nums'] },
});
