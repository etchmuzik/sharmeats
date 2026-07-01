import { Text, View } from 'react-native';
import { colors, font, radius, spacing } from '../theme';

const COPY: Record<string, { icon: string; title: string }> = {
  hand_to_me: { icon: '🤝', title: 'Hand to the guest' },
  leave_at_door: { icon: '🚪', title: "Leave at the door — don't wait" },
  meet_outside: { icon: '🚶', title: 'Guest will meet you outside' },
  no_bell: { icon: '🔕', title: "Don't ring the bell or knock" },
  call_on_arrival: { icon: '📞', title: 'Call the guest on arrival' },
};

interface Props {
  preference: string | null;
  note?: string | null;
}

/**
 * Driver-facing dropoff instruction, mirrors HotelHandoffCard's prominent
 * amber-accented treatment so a customer's handoff request (e.g. "don't ring
 * the bell") is impossible to miss before the driver knocks/rings anyway.
 */
export function DropoffPreferenceCard({ preference, note }: Props) {
  if (!preference) return null;
  const copy = COPY[preference];
  if (!copy) return null;

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
      <Text style={{ fontSize: font.sizes.lg, fontWeight: '800', color: colors.amber }}>
        {copy.icon} {copy.title}
      </Text>
      {note ? (
        <Text style={{ fontSize: font.sizes.sm, color: colors.ink2, marginTop: 4 }}>{note}</Text>
      ) : null}
    </View>
  );
}
