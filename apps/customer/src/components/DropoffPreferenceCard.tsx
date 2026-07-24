import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, font, radius, shadow } from '../theme';
import { useT } from '../i18n';
import { useDirection } from '../lib/direction';
import { selection } from '../haptics';
import type { AddressKind, DropoffPreference } from '../data/types';
import { Icon, type IconName } from './Icon';

interface Props {
  addressKind: AddressKind | undefined;
  value: DropoffPreference | null;
  onChange: (next: DropoffPreference | null) => void;
}

interface ChipDef {
  value: DropoffPreference;
  icon: IconName;
  labelKey:
    | 'checkout.dropoffHandToMe'
    | 'checkout.dropoffLeaveAtDoor'
    | 'checkout.dropoffMeetOutside'
    | 'checkout.dropoffNoBell'
    | 'checkout.dropoffCallOnArrival';
  hideForAddressKinds: AddressKind[];
}

const CHIPS: ChipDef[] = [
  { value: 'hand_to_me', icon: 'handoff', labelKey: 'checkout.dropoffHandToMe', hideForAddressKinds: [] },
  { value: 'leave_at_door', icon: 'door', labelKey: 'checkout.dropoffLeaveAtDoor', hideForAddressKinds: ['hotel', 'beach_pin'] },
  { value: 'meet_outside', icon: 'walk', labelKey: 'checkout.dropoffMeetOutside', hideForAddressKinds: [] },
  { value: 'no_bell', icon: 'quiet', labelKey: 'checkout.dropoffNoBell', hideForAddressKinds: [] },
  { value: 'call_on_arrival', icon: 'phone', labelKey: 'checkout.dropoffCallOnArrival', hideForAddressKinds: [] },
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
              accessibilityRole="radio"
              accessibilityState={{ selected: active }}
              accessibilityLabel={t(chip.labelKey)}
              style={[styles.chip, active && styles.chipActive]}>
              <Icon name={chip.icon} size={17} color={active ? colors.white : colors.ink2} />
              <Text style={[styles.chipText, active && styles.chipTextActive]}>{t(chip.labelKey)}</Text>
            </Pressable>
          );
        })}
      </View>
      {showQuietBanner && (
        <View style={styles.banner}>
          <Icon name="quiet" size={18} color={colors.amber} />
          <Text style={styles.bannerText}>{t('checkout.dropoffQuietBanner')}</Text>
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
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
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
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 10,
    padding: 10,
    borderRadius: radius.md,
    backgroundColor: colors.amberSoft,
    borderWidth: 1,
    borderColor: colors.amber,
  },
  bannerText: { flex: 1, fontSize: font.sizes.sm, color: colors.amber, lineHeight: 20 },
});
