import { Linking, Pressable, ScrollView, Text, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BackButton } from '../src/components/BackButton';
import { font, radius, shadow } from '../src/theme';
import { ThemedStatusBar, makeStyles, useThemeColors } from '../src/themeProvider';
import { useT } from '../src/i18n';
import { tap } from '../src/haptics';
import { Icon } from '../src/components/Icon';

const SUPPORT_PHONE = '201005551234'; // Placeholder; real number set at launch.

/**
 * FAQ copy lives in the locale files, not here (Package 05 Slice A).
 *
 * The previous hardcoded-English version carried two claims that were simply
 * false in production — "We accept Visa and Mastercard from any country" while
 * the app ships cash-only (EXPO_PUBLIC_PAYMENTS_CARD_ENABLED=false), and "at
 * the daily FX rate" while the rate table is static and manually reviewed. It
 * also promised "direct partnerships with the major Sharm resorts" (unverified
 * marketing) and a "30+ days accurate hours" badge mechanism that does not
 * exist. Because the strings were hardcoded EN, none of it was translated and
 * none of it went through locale review.
 *
 * The replacement keys state only what the product verifiably does: cash today
 * with cards "when available", indicative conversion, the SLA credit WITH its
 * EGP 100 cap, and allergy flags as communication rather than medical
 * guarantee. Card copy must not change here until Package 04 Slice B's
 * enablement gate — the truth changes first, then the copy.
 */
const FAQ_KEYS = [
  { q: 'help.q1', a: 'help.a1' },
  { q: 'help.q2', a: 'help.a2' },
  { q: 'help.q3', a: 'help.a3' },
  { q: 'help.q4', a: 'help.a4' },
] as const;

export default function Help() {
  const colors = useThemeColors();
  const styles = useStyles();
  const insets = useSafeAreaInsets();
  const t = useT();
  const { orderCode } = useLocalSearchParams<{ orderCode?: string }>();

  const openWhatsApp = async () => {
    tap();
    const msg = orderCode
      ? t('help.whatsAppOrderMessage', { orderCode })
      : t('help.whatsAppMessage');
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
      <ThemedStatusBar />
      <View style={[styles.head, { paddingTop: insets.top + 12 }]}>
        <BackButton />
        <Text style={styles.title}>{t('help.title')}</Text>
        <View style={{ width: 38 }} />
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 60 + insets.bottom, gap: 16 }}>
        <View style={styles.card}>
          <Text style={styles.cardTitle}>{t('help.contact')}</Text>
          <Pressable
            onPress={openWhatsApp}
            accessibilityRole="button"
            accessibilityLabel={t('help.openWhatsApp')}
            style={styles.waBtn}
          >
            <Icon name="chat" size={20} color={colors.onAccent} />
            <Text style={styles.waBtnText}>{t('help.openWhatsApp')}</Text>
            {orderCode && <Text style={styles.waBtnSub}>#{orderCode}</Text>}
          </Pressable>
          <View style={styles.contactLine}>
            <Icon name="send" size={18} color={colors.sea} />
            <Text style={styles.contactRow}>support@sharmeats.online</Text>
          </View>
          <View style={styles.contactLine}>
            <Icon name="help" size={18} color={colors.sea} />
            <Text style={styles.contactRow}>{t('help.hours')}</Text>
          </View>
        </View>

        <Text style={styles.faqHead}>{t('help.faq')}</Text>
        {FAQ_KEYS.map((f) => (
          <View key={f.q} style={styles.card}>
            <Text style={styles.q}>{t(f.q)}</Text>
            <Text style={styles.a}>{t(f.a)}</Text>
          </View>
        ))}
      </ScrollView>
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
    backgroundColor: colors.surface,
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
  waBtnText: { color: colors.onAccent, fontSize: font.sizes.xl, fontWeight: font.weights.bold },
  waBtnSub: { color: colors.onAccent, fontSize: font.sizes.md, opacity: 0.85 },
  faqHead: { fontSize: font.sizes.xs, fontWeight: font.weights.bold, color: colors.ink2, letterSpacing: 1, textTransform: 'uppercase', marginTop: 6 },
  q: { fontSize: font.sizes.xl, fontWeight: font.weights.bold, color: colors.ink },
  a: { fontSize: font.sizes.lg, color: colors.ink2, marginTop: 6, lineHeight: 21 },
  contactLine: { minHeight: 32, flexDirection: 'row', alignItems: 'center', gap: 8 },
}));
