import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View, Image } from 'react-native';
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, font, radius, shadow } from '../../src/theme';
import { useT, LOCALE_LABELS } from '../../src/i18n';
import { useSession } from '../../src/store/session';
import { tap } from '../../src/haptics';
import { db } from '../../src/data';
import type { User } from '../../src/data/types';

interface Row {
  icon: string;
  label: string;
  value?: string;
  onPress: () => void;
  destructive?: boolean;
}

export default function ProfileTab() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const t = useT();
  const locale = useSession((s) => s.locale);
  const currency = useSession((s) => s.currency);
  const phone = useSession((s) => s.phone);
  const signOut = useSession((s) => s.signOut);
  const [me, setMe] = useState<User | null>(null);

  useEffect(() => {
    db.user.getMe().then(setMe);
  }, []);

  const rows: Row[] = [
    {
      icon: '📍',
      label: t('profile.addresses'),
      onPress: () => router.push('/address/picker'),
    },
    {
      icon: '💳',
      label: t('profile.payment'),
      onPress: () => router.push('/payment/picker'),
    },
    {
      icon: '🌐',
      label: t('profile.language'),
      value: LOCALE_LABELS[locale],
      onPress: () => router.push('/settings'),
    },
    {
      icon: '💱',
      label: t('profile.currency'),
      value: currency,
      onPress: () => router.push('/settings'),
    },
    {
      icon: '🔔',
      label: t('profile.notifications'),
      onPress: () => router.push('/settings'),
    },
    {
      icon: '❓',
      label: t('profile.help'),
      onPress: () => router.push('/help'),
    },
    {
      icon: '🚪',
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
            <Image source={{ uri: 'https://i.pravatar.cc/120?img=12' }} style={styles.avatarImg} />
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
              style={({ pressed }) => [
                styles.row,
                i < rows.length - 1 && { borderBottomWidth: 1, borderBottomColor: colors.line },
                pressed && { backgroundColor: colors.bgSoft },
              ]}>
              <Text style={styles.rowIcon}>{r.icon}</Text>
              <Text
                style={[
                  styles.rowLabel,
                  r.destructive && { color: colors.red },
                ]}>
                {r.label}
              </Text>
              {r.value && <Text style={styles.rowValue}>{r.value}</Text>}
              <Text style={styles.chev}>›</Text>
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
    backgroundColor: colors.white,
    borderWidth: 3,
    borderColor: colors.white,
    ...shadow.card,
  },
  avatarImg: { width: '100%', height: '100%' },
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
  rowIcon: { fontSize: 20, width: 26, textAlign: 'center' },
  rowLabel: { flex: 1, fontSize: font.sizes.xl, color: colors.ink, fontWeight: font.weights.semibold },
  rowValue: { fontSize: font.sizes.lg, color: colors.ink2, marginRight: 4 },
  chev: { fontSize: 22, color: colors.ink3, lineHeight: 22 },
});
