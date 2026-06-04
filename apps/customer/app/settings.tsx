import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useCallback } from 'react';
import { BackButton } from '../src/components/BackButton';
import { colors, font, radius, shadow } from '../src/theme';
import { useT, LOCALE_LABELS, ALL_LOCALES } from '../src/i18n';
import { useSession, type Locale, type Currency } from '../src/store/session';
import { selection, tap } from '../src/haptics';
import { ALL_CURRENCIES } from '../src/currency/fx';
import { db } from '../src/data';

export default function Settings() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const t = useT();
  const locale = useSession((s) => s.locale);
  const setLocale = useSession((s) => s.setLocale);
  const currency = useSession((s) => s.currency);
  const setCurrency = useSession((s) => s.setCurrency);
  const [allergyCount, setAllergyCount] = useState(0);

  useFocusEffect(
    useCallback(() => {
      db.user.getMe().then((u) => setAllergyCount(u.allergyProfile?.length ?? 0));
    }, []),
  );

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <StatusBar style="dark" />
      <View style={[styles.head, { paddingTop: insets.top + 12 }]}>
        <BackButton />
        <Text style={styles.title}>{t('settings.title')}</Text>
        <View style={{ width: 38 }} />
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: 60 + insets.bottom }}>
        <View style={styles.card}>
          <Text style={styles.cardTitle}>{t('profile.language')}</Text>
          <View style={{ marginTop: 10, gap: 6 }}>
            {ALL_LOCALES.map((l) => {
              const isSel = locale === l;
              return (
                <Pressable
                  key={l}
                  onPress={() => {
                    selection();
                    setLocale(l as Locale);
                  }}
                  style={[styles.row, isSel && styles.rowActive]}>
                  <Text style={[styles.rowText, isSel && { color: colors.accent, fontWeight: font.weights.bold }]}>
                    {LOCALE_LABELS[l]}
                  </Text>
                  {isSel && <Text style={styles.check}>✓</Text>}
                </Pressable>
              );
            })}
          </View>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>{t('profile.currency')}</Text>
          <View style={{ marginTop: 10, gap: 6 }}>
            {ALL_CURRENCIES.map((c) => {
              const isSel = currency === c;
              return (
                <Pressable
                  key={c}
                  onPress={() => {
                    selection();
                    setCurrency(c as Currency);
                  }}
                  style={[styles.row, isSel && styles.rowActive]}>
                  <Text style={[styles.rowText, isSel && { color: colors.accent, fontWeight: font.weights.bold }]}>
                    {c}
                  </Text>
                  {isSel && <Text style={styles.check}>✓</Text>}
                </Pressable>
              );
            })}
          </View>
        </View>

        <Pressable
          onPress={() => {
            tap();
            router.push('/settings/allergies');
          }}
          style={styles.card}>
          <View style={styles.allergyRow}>
            <Text style={styles.cardTitle}>{t('profile.allergies')}</Text>
            <Text style={styles.allergyCount}>
              {allergyCount > 0 ? t('allergy.savedCount', { n: allergyCount }) : '+'}
            </Text>
          </View>
        </Pressable>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>{t('profile.notifications')}</Text>
          <View style={[styles.row, { marginTop: 10 }]}>
            <Text style={styles.rowText}>{t('profile.notificationsOrderUpdates')}</Text>
            <View style={[styles.toggle, styles.toggleOn]} />
          </View>
          <View style={styles.row}>
            <Text style={styles.rowText}>{t('profile.notificationsPromotions')}</Text>
            <View style={styles.toggle} />
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  head: {
    paddingHorizontal: 16,
    paddingBottom: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.bg,
  },
  title: { fontSize: font.sizes['5xl'], fontWeight: font.weights.extrabold, letterSpacing: -0.4, color: colors.ink },
  card: {
    backgroundColor: colors.white,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.line,
    padding: 14,
    ...shadow.soft,
  },
  cardTitle: { fontSize: font.sizes['2xl'], fontWeight: font.weights.bold, color: colors.ink },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 10,
    borderRadius: radius.md,
  },
  rowActive: { backgroundColor: colors.accentSoft },
  rowText: { fontSize: font.sizes.xl, color: colors.ink },
  check: { fontSize: 18, color: colors.accent },
  toggle: { width: 44, height: 26, borderRadius: 13, backgroundColor: colors.line2 },
  toggleOn: { backgroundColor: colors.accent },
  allergyRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  allergyCount: {
    fontSize: font.sizes.lg,
    color: colors.accent,
    fontWeight: font.weights.bold,
  },
});
