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
import { LegalRows } from '../../src/components/LegalRows';
import { useUnreadBadges } from '../../src/hooks/useUnreadBadges';
import type { User } from '../../src/data/types';
import { unregisterPush } from '../../src/lib/push';
import { resetAnalyticsUser } from '../../src/lib/analytics';

interface Row {
  icon: IconName;
  label: string;
  value?: string;
  badge?: number;
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
  const unread = useUnreadBadges();

  useEffect(() => {
    db.user.getMe().then(setMe);
  }, []);

  const rows: Row[] = [
    { icon: 'person', label: t('profile.editProfile'), onPress: () => router.push('/edit-profile') },
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
    { icon: 'gift', label: t('profile.invite'), onPress: () => router.push('/invite') },
    { icon: 'chat', label: t('profile.support'), badge: unread.support, onPress: () => router.push('/support') },
    { icon: 'help', label: t('profile.help'), onPress: () => router.push('/help') },
    {
      icon: 'signout',
      label: t('profile.signOut'),
      onPress: () => {
        // Remove this device's push token first so the next account on this
        // phone doesn't receive the previous user's order updates.
        unregisterPush();
        resetAnalyticsUser();
        signOut();
        router.replace('/onboarding');
      },
      destructive: true,
    },
    {
      // Apple Guideline 5.1.1(v): apps with account creation must offer
      // in-app account deletion. Routes to a dedicated confirmation screen.
      icon: 'trash',
      label: t('profile.deleteAccount'),
      onPress: () => router.push('/delete-account'),
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
              {r.badge != null && r.badge > 0 && (
                <View style={styles.rowBadge} accessibilityLabel={`${r.badge} unread`}>
                  <Text style={styles.rowBadgeText}>{r.badge}</Text>
                </View>
              )}
              <Icon name={dir.isRtl ? 'chevronBack' : 'chevronForward'} size={18} color={colors.ink3} />
            </Pressable>
          ))}
        </View>

        <Text style={[styles.sectionLabel, dir.text]}>{t('legal.section')}</Text>
        <View style={styles.section}>
          <LegalRows />
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
  sectionLabel: {
    marginHorizontal: 24,
    marginTop: 22,
    marginBottom: 10,
    fontSize: font.sizes.md,
    fontWeight: font.weights.bold,
    color: colors.ink3,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 14, gap: 14 },
  rowIcon: { width: 26, alignItems: 'center' },
  rowLabel: { flex: 1, fontSize: font.sizes.xl, color: colors.ink, fontWeight: font.weights.semibold },
  rowValue: { fontSize: font.sizes.lg, color: colors.ink2, marginHorizontal: 4 },
  rowBadge: {
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 6,
    marginHorizontal: 4,
  },
  rowBadgeText: { color: colors.white, fontSize: font.sizes.xs, fontWeight: font.weights.bold },
});
