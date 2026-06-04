import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BackButton } from '../src/components/BackButton';
import { colors, font, radius, shadow } from '../src/theme';
import { useT } from '../src/i18n';
import { tap } from '../src/haptics';

const SUPPORT_PHONE = '201005551234'; // Placeholder; real number set at launch.

const FAQ = [
  {
    q: 'How does the 15-minute SLA work?',
    a: 'We tell you the delivery time up front. If your order arrives more than 15 minutes late, we automatically credit 10% of the order back to your sharmeats wallet — no support ticket needed.',
  },
  {
    q: 'Can I pay with my home-country card?',
    a: 'Yes. We accept Visa and Mastercard from any country. Prices are shown in EGP and your home currency at the daily FX rate, then charged in EGP.',
  },
  {
    q: 'Do you deliver to hotel rooms?',
    a: 'Yes. We have direct partnerships with the major Sharm resorts. Pick your hotel, enter your room number, and choose lobby/reception/poolside handoff.',
  },
  {
    q: 'What does "Tourist-safe" mean?',
    a: 'Restaurants with this badge have an English menu, clear allergen + halal/veg/pork flags on every item, and have maintained accurate operating hours for 30+ days.',
  },
];

export default function Help() {
  const insets = useSafeAreaInsets();
  const t = useT();
  const { orderCode } = useLocalSearchParams<{ orderCode?: string }>();

  const openWhatsApp = async () => {
    tap();
    const msg = orderCode
      ? `Hi sharmeats, I need help with order #${orderCode}.`
      : 'Hi sharmeats, I need help with my order.';
    const url = `whatsapp://send?phone=${SUPPORT_PHONE}&text=${encodeURIComponent(msg)}`;
    const supported = await Linking.canOpenURL(url);
    if (supported) {
      Linking.openURL(url);
    } else {
      // Fallback to web WhatsApp if the app isn't installed.
      Linking.openURL(`https://wa.me/${SUPPORT_PHONE}?text=${encodeURIComponent(msg)}`);
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <StatusBar style="dark" />
      <View style={[styles.head, { paddingTop: insets.top + 12 }]}>
        <BackButton />
        <Text style={styles.title}>{t('help.title')}</Text>
        <View style={{ width: 38 }} />
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 60 + insets.bottom, gap: 16 }}>
        <View style={styles.card}>
          <Text style={styles.cardTitle}>{t('help.contact')}</Text>
          <Pressable onPress={openWhatsApp} style={styles.waBtn}>
            <Text style={styles.waBtnText}>💬 {t('help.openWhatsApp')}</Text>
            {orderCode && <Text style={styles.waBtnSub}>#{orderCode}</Text>}
          </Pressable>
          <Text style={styles.contactRow}>✉️ hello@sharmeats.example</Text>
          <Text style={styles.contactRow}>🕐 Daily 8 AM – 2 AM EET</Text>
        </View>

        <Text style={styles.faqHead}>{t('help.faq')}</Text>
        {FAQ.map((f) => (
          <View key={f.q} style={styles.card}>
            <Text style={styles.q}>{f.q}</Text>
            <Text style={styles.a}>{f.a}</Text>
          </View>
        ))}
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
  cardTitle: { fontSize: font.sizes['2xl'], fontWeight: font.weights.bold, color: colors.ink, marginBottom: 8 },
  contactRow: { fontSize: font.sizes.lg, color: colors.ink, paddingVertical: 4 },
  waBtn: {
    backgroundColor: '#25D366',
    borderRadius: radius.lg,
    paddingVertical: 12,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginVertical: 6,
  },
  waBtnText: { color: colors.white, fontSize: font.sizes.xl, fontWeight: font.weights.bold },
  waBtnSub: { color: colors.white, fontSize: font.sizes.md, opacity: 0.85 },
  faqHead: { fontSize: font.sizes.xs, fontWeight: font.weights.bold, color: colors.ink2, letterSpacing: 1, textTransform: 'uppercase', marginTop: 6 },
  q: { fontSize: font.sizes.xl, fontWeight: font.weights.bold, color: colors.ink },
  a: { fontSize: font.sizes.lg, color: colors.ink2, marginTop: 6, lineHeight: 21 },
});
