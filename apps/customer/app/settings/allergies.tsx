import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BackButton } from '../../src/components/BackButton';
import { PrimaryButton } from '../../src/components/PrimaryButton';
import { AllergyChipRow } from '../../src/components/AllergyChipRow';
import { colors, font, radius, shadow } from '../../src/theme';
import { useT } from '../../src/i18n';
import { db } from '../../src/data';
import type { AllergyKey, User } from '../../src/data/types';
import { success } from '../../src/haptics';
import { useGoBack } from '../../src/lib/navigation';

export default function AllergiesSettings() {
  const insets = useSafeAreaInsets();
  const goBack = useGoBack();
  const t = useT();
  const [user, setUser] = useState<User | null>(null);
  const [selected, setSelected] = useState<AllergyKey[]>([]);

  useEffect(() => {
    db.user.getMe().then((u) => {
      setUser(u);
      setSelected(u.allergyProfile ?? []);
    });
  }, []);

  const save = async () => {
    if (!user) return;
    await db.user.update({ allergyProfile: selected });
    success();
    goBack();
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <StatusBar style="dark" />
      <View style={[styles.head, { paddingTop: insets.top + 12 }]}>
        <BackButton />
        <Text style={styles.title}>{t('allergy.title')}</Text>
        <View style={{ width: 38 }} />
      </View>

      <ScrollView
        contentContainerStyle={{
          padding: 20,
          paddingBottom: 140 + insets.bottom,
          gap: 18,
        }}>
        <View style={styles.card}>
          <Text style={styles.cardTitle}>{t('allergy.title')}</Text>
          <Text style={styles.cardSub}>{t('allergy.subtitle')}</Text>
          <View style={{ marginTop: 16 }}>
            <AllergyChipRow selected={selected} onChange={setSelected} />
          </View>
          {selected.length === 0 && (
            <Text style={styles.empty}>{t('allergy.empty')}</Text>
          )}
        </View>
      </ScrollView>

      <View style={[styles.bottom, { paddingBottom: 24 + insets.bottom }]}>
        <PrimaryButton label={t('allergy.save')} onPress={save} />
      </View>
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
  title: {
    fontSize: font.sizes['5xl'],
    fontWeight: font.weights.extrabold,
    letterSpacing: -0.4,
    color: colors.ink,
  },
  card: {
    backgroundColor: colors.white,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.line,
    padding: 16,
    ...shadow.soft,
  },
  cardTitle: {
    fontSize: font.sizes['2xl'],
    fontWeight: font.weights.bold,
    color: colors.ink,
  },
  cardSub: {
    fontSize: font.sizes.lg,
    color: colors.ink2,
    marginTop: 6,
    lineHeight: 22,
  },
  empty: {
    marginTop: 14,
    color: colors.ink3,
    fontSize: font.sizes.md,
    fontStyle: 'italic',
  },
  bottom: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colors.white,
    borderTopWidth: 1,
    borderTopColor: colors.line,
    paddingHorizontal: 16,
    paddingTop: 12,
  },
});
