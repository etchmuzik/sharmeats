import { useCallback, useState } from 'react';
import { Alert, Pressable, ScrollView, Text, View } from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BackButton } from '../../src/components/BackButton';
import { Icon } from '../../src/components/Icon';
import { PrimaryButton } from '../../src/components/PrimaryButton';
import { font, radius, shadow } from '../../src/theme';
import { ThemedStatusBar, makeStyles, useThemeColors } from '../../src/themeProvider';
import { useT } from '../../src/i18n';
import { useSession } from '../../src/store/session';
import { db } from '../../src/data';
import type { Address } from '../../src/data/types';
import { tap, selection } from '../../src/haptics';
import { radioAccessibilityState } from '../../src/lib/accessibility';
import { useGoBack } from '../../src/lib/navigation';

export default function AddressPicker() {
  const colors = useThemeColors();
  const styles = useStyles();
  const router = useRouter();
  const goBack = useGoBack();
  const insets = useSafeAreaInsets();
  const t = useT();
  const selectedAddressId = useSession((s) => s.selectedAddressId);
  const setSelectedAddressId = useSession((s) => s.setSelectedAddressId);
  const [addresses, setAddresses] = useState<Address[]>([]);
  const [active, setActive] = useState<'hotel' | 'street' | 'beach_pin'>('street');

  // Re-fetch on every focus (incl. returning from Add) so a just-saved address
  // appears immediately. A plain mount-only effect left the list stale because
  // popping back from Add reveals this already-mounted screen without remount.
  useFocusEffect(
    useCallback(() => {
      let alive = true;
      db.user.listAddresses().then((all) => {
        if (!alive) return;
        setAddresses(all);
        // Land on the tab of the currently-selected address so a freshly-saved
        // one (selectedAddressId set by Add) is on a visible tab, not hidden
        // under the default 'street' tab.
        const sel = all.find((a) => a.id === selectedAddressId);
        if (sel) setActive(sel.kind);
      });
      return () => {
        alive = false;
      };
    }, [selectedAddressId]),
  );

  const filtered = addresses.filter((a) => a.kind === active);

  const removeAddress = (id: string) => {
    Alert.alert('', t('address.deleteConfirm'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('address.delete'),
        style: 'destructive',
        onPress: async () => {
          await db.user.removeAddress(id);
          if (id === selectedAddressId) setSelectedAddressId(null);
          const all = await db.user.listAddresses();
          setAddresses(all);
        },
      },
    ]);
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <ThemedStatusBar />
      <View style={[styles.head, { paddingTop: insets.top + 12 }]}>
        <BackButton />
        <Text style={styles.title}>{t('address.title')}</Text>
        <View style={{ width: 38 }} />
      </View>

      <View style={styles.tabs}>
        {(['hotel', 'street', 'beach_pin'] as const).map((k) => (
          <Pressable
            key={k}
            testID={`address-kind-${k}`}
            onPress={() => {
              selection();
              setActive(k);
            }}
            accessibilityRole="tab"
            accessibilityLabel={k === 'hotel' ? t('address.hotel') : k === 'street' ? t('address.street') : t('address.beach')}
            accessibilityState={{ selected: active === k }}
            style={[styles.tab, active === k && styles.tabActive]}>
            <Text style={[styles.tabText, active === k && { color: colors.onInk }]}>
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
            <View key={a.id} style={[styles.card, isSel && styles.cardActive]}>
              <Pressable
                testID={`address-option-${a.id}`}
                onPress={() => {
                  tap();
                  setSelectedAddressId(a.id);
                }}
                accessibilityRole="radio"
                accessibilityLabel={`${a.label}. ${a.kind === 'hotel' ? `${a.hotelName}, ${t('address.room')} ${a.roomNumber}` : a.kind === 'street' ? `${a.streetText}, ${a.building ?? ''} ${a.apartment ?? ''}`.trim() : a.beachName ?? t('address.beachPin')}`}
                accessibilityState={radioAccessibilityState(isSel)}
                style={styles.cardBody}>
                <View style={styles.cardLeft}>
                  <Icon
                    name={a.kind === 'hotel' ? 'hotel' : a.kind === 'street' ? 'home' : 'beach'}
                    size={22}
                    color={colors.sea}
                  />
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
              <Pressable
                onPress={() => removeAddress(a.id)}
                hitSlop={10}
                accessibilityRole="button"
                accessibilityLabel={t('address.delete')}
                style={styles.deleteBtn}>
                <Icon name="trash" size={18} color={colors.ink3} />
              </Pressable>
            </View>
          );
        })}

        <Pressable
          onPress={() => router.push(`/address/add?kind=${active}`)}
          style={styles.addNew}>
          <Text style={styles.addNewText}>+ {t('address.add')}</Text>
        </Pressable>
      </ScrollView>

      <View style={[styles.bottom, { paddingBottom: 24 + insets.bottom }]}>
        <PrimaryButton testID="address-picker-use-this" label={t('address.useThis')} onPress={goBack} />
      </View>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
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
    backgroundColor: colors.surface,
    borderWidth: 1.5,
    borderColor: colors.line,
    borderRadius: radius.xl,
    flexDirection: 'row',
    alignItems: 'center',
    ...shadow.soft,
  },
  cardBody: {
    flex: 1,
    padding: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
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
    backgroundColor: colors.surface,
  },
  radioDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.onAccent },
  deleteBtn: { padding: 6, marginEnd: 4 },
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
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.line,
    paddingHorizontal: 16,
    paddingTop: 12,
  },
}));
