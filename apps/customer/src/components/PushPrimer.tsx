/**
 * Contextual push permission primer (Package 03 Slice B).
 *
 * Shown BEFORE the OS dialog, at a value moment — never at app start. The OS
 * dialog is a one-shot on iOS, so the job of this screen is to make sure the
 * customer understands what they are agreeing to before that single chance is
 * spent. Someone who has just placed an order understands "we'll tell you when
 * the driver is close"; someone who has just opened the app for the first time
 * does not.
 *
 * Order updates and offers are described SEPARATELY, because they are separate
 * consents: order tracking is operational, offers are marketing and are opt-in
 * behind their own switch (mig 138/143). Bundling them into one "allow
 * notifications" ask is how apps end up with consent nobody meant to give.
 *
 * "Not now" is a real answer: we record it and stop asking. The OS would still
 * show its dialog, but nagging is how an app trains people to refuse.
 */
import { Modal, Pressable, Text, View } from 'react-native';
import { font, radius, shadow } from '../theme';
import { makeStyles } from '../themeProvider';
import { useT } from '../i18n';
import { useDirection } from '../lib/direction';

export interface PushPrimerProps {
  visible: boolean;
  /** Which value moment triggered this — shapes the headline. */
  context: 'first_order' | 'marketing_opt_in';
  onAllow: () => void;
  onDismiss: () => void;
}

export function PushPrimer({ visible, context, onAllow, onDismiss }: PushPrimerProps) {
  const styles = useStyles();
  const t = useT();
  const dir = useDirection();

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onDismiss}>
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <Text style={styles.emoji}>🔔</Text>
          <Text style={[styles.title, dir.text, styles.center]}>
            {context === 'first_order'
              ? t('push.primerOrderTitle')
              : t('push.primerOffersTitle')}
          </Text>

          {/* Two lines, deliberately: what is operational vs what is marketing. */}
          <Text style={[styles.body, dir.text, styles.center]}>
            {t('push.primerOrderBody')}
          </Text>
          <Text style={[styles.body, dir.text, styles.center]}>
            {t('push.primerOffersBody')}
          </Text>

          <Pressable style={styles.allow} onPress={onAllow} accessibilityRole="button">
            <Text style={styles.allowText}>{t('push.primerAllow')}</Text>
          </Pressable>
          <Pressable style={styles.later} onPress={onDismiss} accessibilityRole="button">
            <Text style={styles.laterText}>{t('push.primerNotNow')}</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const useStyles = makeStyles((colors) => ({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    padding: 24,
    alignItems: 'center',
    ...shadow.card,
  },
  emoji: { fontSize: 44, marginBottom: 8 },
  // dir.text supplies writingDirection (correct for mixed Arabic/Latin
  // strings); this modal's copy is centred, so textAlign is overridden after it.
  center: { textAlign: 'center' },
  title: {
    fontSize: font.sizes['4xl'],
    fontWeight: font.weights.bold,
    color: colors.ink,
    marginBottom: 10,
  },
  body: {
    fontSize: font.sizes.lg,
    color: colors.ink2,
    lineHeight: 21,
    marginBottom: 8,
  },
  allow: {
    marginTop: 12,
    alignSelf: 'stretch',
    backgroundColor: colors.accent,
    borderRadius: radius.lg,
    paddingVertical: 14,
    alignItems: 'center',
  },
  allowText: { color: colors.onAccent, fontWeight: font.weights.bold, fontSize: font.sizes.xl },
  later: { marginTop: 6, paddingVertical: 12, alignItems: 'center', alignSelf: 'stretch' },
  laterText: { color: colors.ink3, fontSize: font.sizes.lg },
}));
