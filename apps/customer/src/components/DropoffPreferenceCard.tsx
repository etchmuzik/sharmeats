import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, font, radius, shadow } from '../theme';
import { useT } from '../i18n';
import { useDirection } from '../lib/direction';
import { selection } from '../haptics';
import type { AddressKind, DropoffPreference } from '../data/types';

interface Props {
  addressKind: AddressKind | undefined;
  value: DropoffPreference | null;
  onChange: (next: DropoffPreference | null) => void;
}

interface ChipDef {
  value: DropoffPreference;
  icon: string;
  labelKey:
    | 'checkout.dropoffHandToMe'
    | 'checkout.dropoffLeaveAtDoor'
    | 'checkout.dropoffMeetOutside'
    | 'checkout.dropoffNoBell'
    | 'checkout.dropoffCallOnArrival';
  hideForAddressKinds: AddressKind[];
}

const CHIPS: ChipDef[] = [
  { value: 'hand_to_me', icon: '🤝', labelKey: 'checkout.dropoffHandToMe', hideForAddressKinds: [] },
  { value: 'leave_at_door', icon: '🚪', labelKey: 'checkout.dropoffLeaveAtDoor', hideForAddressKinds: ['hotel', 'beach_pin'] },
  { value: 'meet_outside', icon: '🚶', labelKey: 'checkout.dropoffMeetOutside', hideForAddressKinds: [] },
  { value: 'no_bell', icon: '🔕', labelKey: 'checkout.dropoffNoBell', hideForAddressKinds: [] },
  { value: 'call_on_arrival', icon: '📞', labelKey: 'checkout.dropoffCallOnArrival', hideForAddressKinds: [] },
];

const QUIET_VALUES: DropoffPreference[] = ['leave_at_door', 'no_bell'];

/** Pure chip-visibility filter: which chips should render for a given address kind. */
export function getVisibleChips(addressKind: AddressKind | undefined): ChipDef[] {
  return CHIPS.filter((c) => !addressKind || !c.hideForAddressKinds.includes(addressKind));
}

/** Pure banner-trigger logic: does this dropoff preference warrant the quiet/contactless banner. */
export function isQuietPreference(value: DropoffPreference | null): boolean {
  return value !== null && QUIET_VALUES.includes(value);
}

export function DropoffPreferenceCard({ addressKind, value, onChange }: Props) {
  const t = useT();
  const dir = useDirection();
  const visibleChips = getVisibleChips(addressKind);
  const showQuietBanner = isQuietPreference(value);

  return (
    <View style={styles.card}>
      <Text style={styles.title}>{t('checkout.dropoffTitle')}</Text>
      <View style={[styles.chipRow, dir.row]}>
        {visibleChips.map((chip) => {
          const active = value === chip.value;
          return (
            <Pressable
              key={chip.value}
              onPress={() => {
                selection();
                onChange(active ? null : chip.value);
              }}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              accessibilityLabel={t(chip.labelKey)}
              style={[styles.chip, active && styles.chipActive]}>
              <Text style={[styles.chipText, active && styles.chipTextActive]}>
                {chip.icon} {t(chip.labelKey)}
              </Text>
            </Pressable>
          );
        })}
      </View>
      {showQuietBanner && (
        <View style={styles.banner}>
          <Text style={styles.bannerText}>🤫 {t('checkout.dropoffQuietBanner')}</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.xl,
    padding: 14,
    marginBottom: 12,
    ...shadow.soft,
  },
  title: { fontSize: font.sizes['2xl'], fontWeight: font.weights.bold, color: colors.ink },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.white,
  },
  chipActive: { backgroundColor: colors.ink, borderColor: colors.ink },
  chipText: { fontSize: font.sizes.md, color: colors.ink, fontWeight: font.weights.bold },
  chipTextActive: { color: colors.white },
  banner: {
    marginTop: 10,
    padding: 10,
    borderRadius: radius.md,
    backgroundColor: '#fff4e8',
    borderWidth: 1,
    borderColor: '#f3d9b8',
  },
  bannerText: { fontSize: font.sizes.sm, color: '#8a5a1c', lineHeight: 18 },
});
