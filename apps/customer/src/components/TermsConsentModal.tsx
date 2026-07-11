import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, font, radius, shadow } from '../theme';
import { PrimaryButton } from './PrimaryButton';
import { Icon } from './Icon';
import { useT } from '../i18n';
import { useDirection } from '../lib/direction';
import { tap } from '../haptics';
import { LEGAL_URLS, openLegal } from '../legal';

interface Props {
  visible: boolean;
  /** True while the acceptance write is in flight — disables the agree button. */
  busy?: boolean;
  onAgree: () => void;
}

/**
 * Lightweight, non-dismissable consent checkpoint. Shown to a signed-in user
 * whose recorded ToS acceptance is missing or stale. Presents the tappable
 * Terms / Privacy links and a single "I agree" action. A returning user who has
 * already accepted the current version never sees this (the caller gates on the
 * recorded version), so it stays minimal and non-annoying.
 */
export function TermsConsentModal({ visible, busy, onAgree }: Props) {
  const t = useT();
  const dir = useDirection();
  const insets = useSafeAreaInsets();

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={() => {}}>
      <View style={styles.backdrop}>
        <View style={[styles.sheet, { paddingBottom: insets.bottom + 20 }]}>
          <View style={styles.iconWrap}>
            <Icon name="doc" size={28} color={colors.sea} />
          </View>
          <Text style={[styles.title, dir.text]}>{t('consent.title')}</Text>
          <Text style={[styles.body, dir.text]}>{t('consent.body')}</Text>

          <View style={styles.links}>
            <Pressable
              onPress={() => {
                tap();
                openLegal(LEGAL_URLS.terms);
              }}
              accessibilityRole="link"
              accessibilityLabel={t('legal.terms')}
              hitSlop={8}>
              <Text style={styles.link}>{t('legal.terms')}</Text>
            </Pressable>
            <Text style={styles.linkDot}>·</Text>
            <Pressable
              onPress={() => {
                tap();
                openLegal(LEGAL_URLS.privacy);
              }}
              accessibilityRole="link"
              accessibilityLabel={t('legal.privacy')}
              hitSlop={8}>
              <Text style={styles.link}>{t('legal.privacy')}</Text>
            </Pressable>
          </View>

          <PrimaryButton
            label={busy ? t('common.loading') : t('consent.agree')}
            onPress={onAgree}
            disabled={busy}
            style={{ marginTop: 20 }}
          />
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: colors.white,
    borderTopLeftRadius: radius.xxxl,
    borderTopRightRadius: radius.xxxl,
    paddingHorizontal: 24,
    paddingTop: 24,
    ...shadow.card,
  },
  iconWrap: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.seaSoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  title: { fontSize: font.sizes['7xl'], fontWeight: font.weights.extrabold, color: colors.ink, letterSpacing: -0.4 },
  body: { fontSize: font.sizes.xl, color: colors.ink2, lineHeight: 22, marginTop: 8 },
  links: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 16 },
  link: { fontSize: font.sizes.xl, color: colors.sea, fontWeight: font.weights.semibold },
  linkDot: { fontSize: font.sizes.xl, color: colors.ink3 },
});
