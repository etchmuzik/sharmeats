import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BackButton } from '../../src/components/BackButton';
import { PrimaryButton } from '../../src/components/PrimaryButton';
import { colors, font, radius, shadow } from '../../src/theme';
import { useT } from '../../src/i18n';
import { db } from '../../src/data';
import type { PaymentMethod } from '../../src/data/types';
import { selection } from '../../src/haptics';
import { useGoBack } from '../../src/lib/navigation';

const ICON: Record<PaymentMethod['kind'], string> = {
  cash: '💵',
  vodafone_cash: '📱',
  instapay: '💸',
  fawry: '🟧',
  card: '💳',
  apple_pay: '',
};

export default function PaymentPicker() {
  const goBack = useGoBack('/checkout');
  const insets = useSafeAreaInsets();
  const t = useT();
  const [methods, setMethods] = useState<PaymentMethod[]>([]);
  const [chosen, setChosen] = useState<string | null>(null);

  useEffect(() => {
    db.user.listPaymentMethods().then((m) => {
      setMethods(m);
      setChosen(m.find((x) => x.isDefault)?.id ?? m[0]?.id ?? null);
    });
  }, []);

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <StatusBar style="dark" />
      <View style={[styles.head, { paddingTop: insets.top + 12 }]}>
        <BackButton fallback="/checkout" />
        <Text style={styles.title}>{t('payment.title')}</Text>
        <View style={{ width: 38 }} />
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, gap: 10, paddingBottom: 140 + insets.bottom }}>
        {methods.map((m) => {
          const isSel = chosen === m.id;
          return (
            <Pressable
              key={m.id}
              onPress={() => {
                selection();
                setChosen(m.id);
              }}
              style={[styles.card, isSel && styles.cardActive]}>
              <Text style={styles.icon}>{ICON[m.kind] || '💳'}</Text>
              <View style={{ flex: 1 }}>
                <Text style={styles.label}>{m.label}</Text>
                <Text style={styles.sub}>{m.subline}</Text>
              </View>
              <View
                style={[
                  styles.radio,
                  isSel && { backgroundColor: colors.accent, borderColor: colors.accent },
                ]}>
                {isSel && <View style={styles.radioDot} />}
              </View>
            </Pressable>
          );
        })}
      </ScrollView>

      <View style={[styles.bottom, { paddingBottom: 24 + insets.bottom }]}>
        <PrimaryButton
          label={t('common.save')}
          onPress={async () => {
            if (chosen) await db.user.setDefaultPaymentMethod(chosen);
            goBack();
          }}
        />
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
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 14,
    borderWidth: 1.5,
    borderColor: colors.line,
    borderRadius: radius.xl,
    backgroundColor: colors.white,
    ...shadow.soft,
  },
  cardActive: { borderColor: colors.accent },
  icon: { fontSize: 28, width: 38, textAlign: 'center' },
  label: { fontSize: font.sizes.xl, color: colors.ink, fontWeight: font.weights.bold },
  sub: { fontSize: font.sizes.md, color: colors.ink2, marginTop: 2 },
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
