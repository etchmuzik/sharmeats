import { Text, View } from 'react-native';
import { colors, font, radius, spacing } from '../theme';
import { Icon } from './Icon';

/** The handoff styles a hotel address can carry (mirrors the DB handoff enum). */
type Handoff = 'lobby' | 'reception' | 'poolside';

interface HotelHandoffCardProps {
  hotelName?: string;
  roomNumber?: string;
  // Accept a loose string: address_snapshot is denormalized JSON from the DB and
  // could carry an unexpected value. isHandoff() narrows it before use, falling
  // back to a generic instruction — so a bad value degrades gracefully.
  handoff?: string;
  landmark?: string;
}

// Driver-facing instruction for each handoff style. This is the whole point of
// the "no phone needed" promise: the driver must know exactly where to hand the
// order over without calling the guest.
const HANDOFF_COPY: Record<Handoff, { title: string; hint: string }> = {
  reception: { title: 'Hand to reception', hint: 'Leave with the front desk under the guest name.' },
  lobby: { title: 'Meet in the lobby', hint: 'The guest will meet you in the hotel lobby.' },
  poolside: { title: 'Deliver poolside', hint: 'Take the order to the pool area and ask staff for the guest.' },
};

function isHandoff(v: string | undefined): v is Handoff {
  return v === 'lobby' || v === 'reception' || v === 'poolside';
}

/**
 * Prominent hotel-delivery card for the driver. Surfaces the room number large
 * and the handoff instruction in plain language, so a tourist's order can be
 * delivered with zero phone calls — the single biggest Sharm differentiator.
 */
export function HotelHandoffCard({ hotelName, roomNumber, handoff, landmark }: HotelHandoffCardProps) {
  const copy = isHandoff(handoff) ? HANDOFF_COPY[handoff] : null;

  return (
    <View
      style={{
        marginTop: spacing.md,
        backgroundColor: colors.white,
        borderWidth: 1,
        borderColor: colors.accentSoft,
        borderRadius: radius.xl,
        overflow: 'hidden',
      }}
    >
      {/* Header: hotel + "no call needed" trust line */}
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: spacing.sm,
          backgroundColor: colors.accentSoft,
          paddingHorizontal: spacing.lg,
          paddingVertical: spacing.md,
        }}
      >
        <Icon name="hotel" size={18} color={colors.accentDark} />
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: font.sizes.base, fontWeight: '800', color: colors.ink }} numberOfLines={1}>
            {hotelName ?? 'Hotel delivery'}
          </Text>
          <Text style={{ fontSize: font.sizes.xs, fontWeight: '700', color: colors.accentDark }}>
            No phone call needed
          </Text>
        </View>
      </View>

      {/* Room number — the one thing the driver must not miss. Big and bold. */}
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.lg, paddingVertical: spacing.lg, gap: spacing.lg }}>
        <View
          style={{
            backgroundColor: colors.bgSoft,
            borderRadius: radius.lg,
            paddingHorizontal: spacing.lg,
            paddingVertical: spacing.sm,
            minWidth: 84,
            alignItems: 'center',
          }}
        >
          <Text style={{ fontSize: font.sizes.xs, color: colors.ink3, fontWeight: '700', textTransform: 'uppercase' }}>
            Room
          </Text>
          <Text style={{ fontSize: font.sizes.xxl, fontWeight: '800', color: colors.ink, letterSpacing: 0.5 }}>
            {roomNumber ?? '—'}
          </Text>
        </View>

        <View style={{ flex: 1 }}>
          {copy ? (
            <>
              <Text style={{ fontSize: font.sizes.lg, fontWeight: '700', color: colors.ink }}>{copy.title}</Text>
              <Text style={{ fontSize: font.sizes.sm, color: colors.ink2, marginTop: 2, lineHeight: 18 }}>
                {copy.hint}
              </Text>
            </>
          ) : (
            <Text style={{ fontSize: font.sizes.lg, fontWeight: '700', color: colors.ink }}>
              Deliver to the room
            </Text>
          )}
        </View>
      </View>

      {landmark ? (
        <View style={{ paddingHorizontal: spacing.lg, paddingBottom: spacing.lg }}>
          <Text style={{ color: colors.ink2, fontSize: font.sizes.sm }}>Landmark: {landmark}</Text>
        </View>
      ) : null}
    </View>
  );
}
