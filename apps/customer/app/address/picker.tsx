import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BackButton } from '../../src/components/BackButton';
import { PrimaryButton } from '../../src/components/PrimaryButton';
import { colors, font, radius, shadow } from '../../src/theme';
import { useT } from '../../src/i18n';
import { useSession } from '../../src/store/session';
import { db } from '../../src/data';
import type { Address } from '../../src/data/types';
import { tap, selection } from '../../src/haptics';
import { useGoBack } from '../../src/lib/navigation';

export default function AddressPicker() {
  const router = useRouter();
  const goBack = useGoBack();
  const insets = useSafeAreaInsets();
  const t = useT();
  const selectedAddressId = useSession((s) => s.selectedAddressId);
  const setSelectedAddressId = useSession((s) => s.setSelectedAddressId);
  const [addresses, setAddresses] = useState<Address[]>([]);
  const [active, setActive] = useState<'hotel' | 'street' | 'beach_pin'>('street');

  useEffect(() => {
    db.user.listAddresses().then(setAddresses);
  }, []);

  const filtered = addresses.filter((a) => a.kind === active);

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <StatusBar style="dark" />
      <View style={[styles.head, { paddingTop: insets.top + 12 }]}>
        <BackButton />
        <Text style={styles.title}>{t('address.title')}</Text>
        <View style={{ width: 38 }} />
      </View>

      <View style={styles.tabs}>
        {(['hotel', 'street', 'beach_pin'] as const).map((k) => (
          <Pressable
            key={k}
            onPress={() => {
              selection();
              setActive(k);
            }}
            style={[styles.tab, active === k && styles.tabActive]}>
            <Text style={[styles.tabText, active === k && { color: colors.white }]}>
              {k === 'hotel' ? t('address.hotel') : k === 'street' ? t('address.street') : t('address.beach')}
            </Text>
          </Pressable>
        ))}
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 140 + insets.bottom, gap: 10 }}>
        {filtered.length === 0 && (
          <View style={{ paddingTop: 40, alignItems: 'center' }}>
            <Text style={{ color: colors.ink3, fontSize: font.sizes.lg }}>{t('address.empty')}</Text>
          </View>
        )}
        {filtered.map((a) => {
          const isSel = a.id === selectedAddressId;
          return (
            <Pressable
              key={a.id}
              onPress={() => {
                tap();
                setSelectedAddressId(a.id);
              }}
              style={[styles.card, isSel && styles.cardActive]}>
              <View style={styles.cardLeft}>
                <Text style={styles.cardIcon}>
                  {a.kind === 'hotel' ? '🏨' : a.kind === 'street' ? '🏢' : '🏖️'}
                </Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.cardTitle}>{a.label}</Text>
                <Text style={styles.cardSub}>
                  {a.kind === 'hotel'
                    ? `${a.hotelName} · ${t('address.room')} ${a.roomNumber}`
                    : a.kind === 'street'
                      ? `${a.streetText} · ${a.building ?? ''} ${a.apartment ?? ''}`.trim()
                      : `${a.beachName ?? t('address.beachPin')}`}
                </Text>
              </View>
              <View
                style={[styles.radio, isSel && { backgroundColor: colors.accent, borderColor: colors.accent }]}>
                {isSel && <View style={styles.radioDot} />}
              </View>
            </Pressable>
          );
        })}

        <Pressable
          onPress={() => router.push(`/address/add?kind=${active}`)}
          style={styles.addNew}>
          <Text style={styles.addNewText}>+ {t('address.add')}</Text>
        </Pressable>
      </ScrollView>

      <View style={[styles.bottom, { paddingBottom: 24 + insets.bottom }]}>
        <PrimaryButton label={t('address.useThis')} onPress={goBack} />
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
  title: { fontSize: font.sizes['5xl'], fontWeight: font.weights.extrabold, letterSpacing: -0.4, color: colors.ink },
  tabs: { flexDirection: 'row', paddingHorizontal: 16, gap: 8, paddingBottom: 10 },
  tab: { paddingHorizontal: 14, paddingVertical: 9, borderRadius: radius.pill, backgroundColor: colors.bgSoft },
  tabActive: { backgroundColor: colors.ink },
  tabText: { fontSize: font.sizes.lg, color: colors.ink, fontWeight: font.weights.bold },
  card: {
    backgroundColor: colors.white,
    borderWidth: 1.5,
    borderColor: colors.line,
    borderRadius: radius.xl,
    padding: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    ...shadow.soft,
  },
  cardActive: { borderColor: colors.accent },
  cardLeft: { width: 36, alignItems: 'center' },
  cardIcon: { fontSize: 22 },
  cardTitle: { fontSize: font.sizes.xl, color: colors.ink, fontWeight: font.weights.bold },
  cardSub: { fontSize: font.sizes.md, color: colors.ink2, marginTop: 3 },
  radio: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 1.5,
    borderColor: colors.line,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.white,
  },
  radioDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.white },
  addNew: {
    borderRadius: radius.xl,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: colors.line2,
    padding: 16,
    alignItems: 'center',
    backgroundColor: 'transparent',
  },
  addNewText: { fontSize: font.sizes.xl, fontWeight: font.weights.bold, color: colors.ink2 },
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
