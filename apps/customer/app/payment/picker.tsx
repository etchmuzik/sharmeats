import { useEffect, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BackButton } from '../../src/components/BackButton';
import { PrimaryButton } from '../../src/components/PrimaryButton';
import { Icon, type IconName } from '../../src/components/Icon';
import { font, radius, shadow } from '../../src/theme';
import { ThemedStatusBar, makeStyles, useThemeColors } from '../../src/themeProvider';
import { useT } from '../../src/i18n';
import { useDirection } from '../../src/lib/direction';
import { db } from '../../src/data';
import type { PaymentMethod } from '../../src/data/types';
import { selection } from '../../src/haptics';
import { localizedPayment } from '../../src/lib/payments';
import { useGoBack } from '../../src/lib/navigation';

const ICON: Record<PaymentMethod['kind'], IconName> = {
  cash: 'cash',
  vodafone_cash: 'wallet',
  instapay: 'transfer',
  fawry: 'receipt',
  card: 'card',
  apple_pay: 'card',
};

export default function PaymentPicker() {
  const colors = useThemeColors();
  const styles = useStyles();
  const goBack = useGoBack('/checkout');
  const insets = useSafeAreaInsets();
  const t = useT();
  const dir = useDirection();
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
      <ThemedStatusBar />
      <View style={[styles.head, { paddingTop: insets.top + 12 }]}>
        <BackButton fallback="/checkout" />
        <Text style={styles.title}>{t('payment.title')}</Text>
        <View style={{ width: 38 }} />
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, gap: 10, paddingBottom: 140 + insets.bottom }}>
        {methods.map((m) => {
          const isSel = chosen === m.id;
          const loc = localizedPayment(t, m);
          return (
            <Pressable
              key={m.id}
              onPress={() => {
                selection();
                setChosen(m.id);
              }}
              accessibilityRole="radio"
              accessibilityState={{ selected: isSel }}
              accessibilityLabel={`${loc.label}${loc.subline ? `, ${loc.subline}` : ''}`}
              style={[styles.card, dir.row, isSel && styles.cardActive]}>
              <View style={styles.icon}>
                <Icon name={ICON[m.kind] ?? 'card'} size={24} color={colors.ink} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.label, dir.text]}>{loc.label}</Text>
                <Text style={[styles.sub, dir.text]}>{loc.subline}</Text>
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
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 14,
    borderWidth: 1.5,
    borderColor: colors.line,
    borderRadius: radius.xl,
    backgroundColor: colors.surface,
    ...shadow.soft,
  },
  cardActive: { borderColor: colors.accent },
  icon: { width: 38, alignItems: 'center' },
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
    backgroundColor: colors.surface,
  },
  radioDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.onAccent },
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
