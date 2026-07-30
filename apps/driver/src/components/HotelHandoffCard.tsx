import { Text, View } from 'react-native';
import { font, radius, spacing } from '../theme';
import { useThemeColors } from '../themeProvider';
import { Icon } from './Icon';
import { useI18n } from '../i18n-context';
import type { TranslationKey } from '../i18n';

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
const HANDOFF_COPY: Record<Handoff, { title: TranslationKey; hint: TranslationKey }> = {
  reception: { title: 'hotel.receptionTitle', hint: 'hotel.receptionHint' },
  lobby: { title: 'hotel.lobbyTitle', hint: 'hotel.lobbyHint' },
  poolside: { title: 'hotel.poolsideTitle', hint: 'hotel.poolsideHint' },
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
  const colors = useThemeColors();
  const { direction, t } = useI18n();
  const copy = isHandoff(handoff) ? HANDOFF_COPY[handoff] : null;

  return (
    <View
      style={{
        marginTop: spacing.md,
        backgroundColor: colors.surface,
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
            {hotelName ?? t('hotel.delivery')}
          </Text>
          <Text style={{ fontSize: font.sizes.xs, fontWeight: '700', color: colors.accentDark }}>
            {t('hotel.noCall')}
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
            {t('hotel.room')}
          </Text>
          <Text style={{ fontSize: font.sizes.xxl, fontWeight: '800', color: colors.ink, letterSpacing: 0.5 }}>
            {roomNumber ?? '—'}
          </Text>
        </View>

        <View style={{ flex: 1 }}>
          {copy ? (
            <>
              <Text style={{ fontSize: font.sizes.lg, fontWeight: '700', color: colors.ink, textAlign: direction.textAlign }}>{t(copy.title)}</Text>
              <Text style={{ fontSize: font.sizes.sm, color: colors.ink2, marginTop: 2, lineHeight: 18 }}>
                {t(copy.hint)}
              </Text>
            </>
          ) : (
            <Text style={{ fontSize: font.sizes.lg, fontWeight: '700', color: colors.ink }}>
              {t('hotel.toRoom')}
            </Text>
          )}
        </View>
      </View>

      {landmark ? (
        <View style={{ paddingHorizontal: spacing.lg, paddingBottom: spacing.lg }}>
          <Text style={{ color: colors.ink2, fontSize: font.sizes.sm, textAlign: direction.textAlign }}>{t('job.landmark', { landmark })}</Text>
        </View>
      ) : null}
    </View>
  );
}
