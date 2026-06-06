import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, font, radius, shadow } from '../../src/theme';
import { Icon, type IconName } from '../../src/components/Icon';
import { useT, LOCALE_LABELS } from '../../src/i18n';
import { useDirection } from '../../src/lib/direction';
import { useSession } from '../../src/store/session';
import { tap } from '../../src/haptics';
import { db } from '../../src/data';
import type { User } from '../../src/data/types';

interface Row {
  icon: IconName;
  label: string;
  value?: string;
  onPress: () => void;
  destructive?: boolean;
}

export default function ProfileTab() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const t = useT();
  const dir = useDirection();
  const locale = useSession((s) => s.locale);
  const currency = useSession((s) => s.currency);
  const phone = useSession((s) => s.phone);
  const signOut = useSession((s) => s.signOut);
  const [me, setMe] = useState<User | null>(null);

  useEffect(() => {
    db.user.getMe().then(setMe);
  }, []);

  const rows: Row[] = [
    { icon: 'location', label: t('profile.addresses'), onPress: () => router.push('/address/picker') },
    { icon: 'card', label: t('profile.payment'), onPress: () => router.push('/payment/picker') },
    {
      icon: 'globe',
      label: t('profile.language'),
      value: LOCALE_LABELS[locale],
      onPress: () => router.push('/settings'),
    },
    { icon: 'currency', label: t('profile.currency'), value: currency, onPress: () => router.push('/settings') },
    { icon: 'bell', label: t('profile.notifications'), onPress: () => router.push('/settings') },
    { icon: 'help', label: t('profile.help'), onPress: () => router.push('/help') },
    {
      icon: 'signout',
      label: t('profile.signOut'),
      onPress: () => {
        signOut();
        router.replace('/onboarding');
      },
      destructive: true,
    },
  ];

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <StatusBar style="dark" />
      <ScrollView contentContainerStyle={{ paddingBottom: 120 + insets.bottom }}>
        <View style={[styles.head, { paddingTop: insets.top + 14 }]}>
          <View style={styles.avatar}>
            {me?.displayName && me.displayName.toLowerCase() !== 'guest' ? (
              <Text style={styles.avatarInitial}>{me.displayName.charAt(0).toUpperCase()}</Text>
            ) : (
              <Icon name="person" size={40} color={colors.sea} />
            )}
          </View>
          <Text style={styles.name}>{me?.displayName ?? 'Guest'}</Text>
          <Text style={styles.phone}>{phone ?? me?.phone}</Text>
        </View>

        <View style={styles.section}>
          {rows.map((r, i) => (
            <Pressable
              key={r.label}
              onPress={() => {
                tap();
                r.onPress();
              }}
              accessibilityRole="button"
              accessibilityLabel={r.value ? `${r.label}, ${r.value}` : r.label}
              style={({ pressed }) => [
                styles.row,
                dir.row,
                i < rows.length - 1 && { borderBottomWidth: 1, borderBottomColor: colors.line },
                pressed && { backgroundColor: colors.bgSoft },
              ]}>
              <View style={styles.rowIcon}>
                <Icon name={r.icon} size={20} color={r.destructive ? colors.red : colors.ink2} />
              </View>
              <Text style={[styles.rowLabel, dir.text, r.destructive && { color: colors.red }]}>
                {r.label}
              </Text>
              {r.value && <Text style={styles.rowValue}>{r.value}</Text>}
              <Icon name={dir.isRtl ? 'chevronBack' : 'chevronForward'} size={18} color={colors.ink3} />
            </Pressable>
          ))}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  head: { paddingHorizontal: 24, paddingBottom: 22, alignItems: 'center' },
  avatar: {
    width: 88,
    height: 88,
    borderRadius: 44,
    overflow: 'hidden',
    backgroundColor: colors.seaSoft,
    borderWidth: 3,
    borderColor: colors.white,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadow.card,
  },
  avatarInitial: { fontSize: 38, fontWeight: font.weights.extrabold, color: colors.sea },
  name: { fontSize: font.sizes['7xl'], fontWeight: font.weights.extrabold, color: colors.ink, marginTop: 12, letterSpacing: -0.4 },
  phone: { fontSize: font.sizes.lg, color: colors.ink2, marginTop: 4 },
  section: {
    marginHorizontal: 16,
    backgroundColor: colors.white,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.line,
    overflow: 'hidden',
    ...shadow.soft,
  },
  row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 14, gap: 14 },
  rowIcon: { width: 26, alignItems: 'center' },
  rowLabel: { flex: 1, fontSize: font.sizes.xl, color: colors.ink, fontWeight: font.weights.semibold },
  rowValue: { fontSize: font.sizes.lg, color: colors.ink2, marginHorizontal: 4 },
});
