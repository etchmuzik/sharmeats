import { Text, View } from 'react-native';
import { colors, font, radius, spacing } from '../theme';
import { Icon, type IconName } from './Icon';
import { useI18n } from '../i18n-context';
import type { TranslationKey } from '../i18n';
import {
  parseCashChangeNote,
  shouldRenderDropoffCard,
} from '../cashChangeNote';

const COPY: Record<string, { icon: IconName; title: TranslationKey }> = {
  hand_to_me: { icon: 'handoff', title: 'dropoff.handToGuest' },
  leave_at_door: { icon: 'door', title: 'dropoff.leaveAtDoor' },
  meet_outside: { icon: 'walk', title: 'dropoff.meetOutside' },
  no_bell: { icon: 'quiet', title: 'dropoff.noBell' },
  call_on_arrival: { icon: 'phone', title: 'dropoff.callOnArrival' },
};

interface Props {
  preference: string | null;
  note?: string | null;
  /** Server-authoritative order total; cash-change markers reconcile against it. */
  collectibleEgp?: number | null;
}

/**
 * Driver-facing dropoff instruction, mirrors HotelHandoffCard's prominent
 * amber-accented treatment so a customer's handoff request (e.g. "don't ring
 * the bell") is impossible to miss before the driver knocks/rings anyway.
 */
export function DropoffPreferenceCard({
  preference,
  note,
  collectibleEgp,
}: Props) {
  const { t } = useI18n();
  const copy = preference ? COPY[preference] : undefined;
  const parsed = parseCashChangeNote(note, collectibleEgp);
  const { customerNote, cashChange } = parsed;
  if (!shouldRenderDropoffCard(Boolean(copy), parsed)) return null;
  const title = copy?.title ?? (cashChange ? 'cashChange.title' : 'dropoff.noteTitle');
  const icon = copy?.icon ?? (cashChange ? 'cash' : 'handoff');

  return (
    <View
      style={{
        marginTop: spacing.md,
        backgroundColor: colors.amberSoft,
        borderWidth: 1,
        borderColor: colors.amber,
        borderRadius: radius.xl,
        padding: spacing.lg,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
        <Icon name={icon} size={20} color={colors.amber} />
        <Text style={{ flex: 1, fontSize: font.sizes.lg, fontWeight: '800', color: colors.amber }}>
          {t(title)}
        </Text>
      </View>
      {customerNote ? (
        <Text style={{ fontSize: font.sizes.sm, color: colors.ink2, marginTop: 4 }}>
          {customerNote}
        </Text>
      ) : null}
      {cashChange ? (
        <Text
          accessibilityRole="text"
          style={{
            fontSize: font.sizes.base,
            color: colors.ink,
            fontWeight: '800',
            marginTop: customerNote ? spacing.sm : 4,
          }}
        >
          {t('cashChange.instruction', {
            tender: cashChange.tenderEgp,
            change: cashChange.changeEgp,
          })}
        </Text>
      ) : null}
    </View>
  );
}
