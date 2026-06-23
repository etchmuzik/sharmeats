import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, Share, StyleSheet, Text, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Clipboard from 'expo-clipboard';
import { BackButton } from '../src/components/BackButton';
import { Icon } from '../src/components/Icon';
import { colors, font, radius, shadow } from '../src/theme';
import { useT } from '../src/i18n';
import { tap, success } from '../src/haptics';
import { db } from '../src/data';
import { track } from '../src/lib/analytics';

// The public landing page carries deep links; sharing it alongside the code
// gives a friend a one-tap path to the app stores.
const SHARE_URL = 'https://sharmeats.online';

type ViewState =
  | { kind: 'loading' }
  | { kind: 'loaded'; code: string }
  | { kind: 'error' };

export default function Invite() {
  const insets = useSafeAreaInsets();
  const t = useT();
  const [state, setState] = useState<ViewState>({ kind: 'loading' });
  const [copied, setCopied] = useState(false);

  // Load (and lazily mint) the caller's referral code. Tolerates failure with a
  // retry path. useCallback so the effect + error-retry Pressable share one fn.
  const load = useCallback(async () => {
    setState({ kind: 'loading' });
    try {
      const code = await db.user.myReferralCode();
      setState({ kind: 'loaded', code });
    } catch {
      setState({ kind: 'error' });
    }
  }, []);

  // Fire once on mount. useEffect (not a useState initializer) is the correct
  // place for a lifecycle side effect — matches the app's screen conventions.
  useEffect(() => {
    void load();
  }, [load]);

  const code = state.kind === 'loaded' ? state.code : '';

  const copy = async () => {
    if (!code) return;
    tap();
    await Clipboard.setStringAsync(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };

  const share = async () => {
    if (!code) return;
    success();
    const message = t('invite.shareMessage', { code, url: SHARE_URL });
    try {
      const result = await Share.share({ message });
      // Only count a genuine share — a dismissed sheet isn't a referral sent,
      // so it must not pollute the funnel. Share.share resolves (not rejects)
      // on dismissal, so this branch is the real success signal.
      if (result.action === Share.sharedAction) {
        track('referral_shared', { code });
      }
    } catch {
      // A REJECTED promise is a real failure (no share targets, system error),
      // not a dismissal — tell the user instead of swallowing it silently.
      Alert.alert(t('invite.shareError'));
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <StatusBar style="dark" />
      <View style={[styles.head, { paddingTop: insets.top + 12 }]}>
        <BackButton />
        <Text style={styles.title}>{t('invite.title')}</Text>
        <View style={{ width: 38 }} />
      </View>

      <View style={styles.body}>
        <View style={styles.hero}>
          <View style={styles.giftCircle}>
            <Icon name="gift" size={40} color={colors.sea} />
          </View>
          <Text style={styles.heroTitle}>{t('invite.heroTitle')}</Text>
          <Text style={styles.heroSub}>{t('invite.heroSub')}</Text>
        </View>

        {state.kind === 'loading' && (
          <View style={styles.codeCard}>
            <ActivityIndicator color={colors.sea} />
          </View>
        )}

        {state.kind === 'error' && (
          <Pressable style={styles.codeCard} onPress={load} accessibilityRole="button">
            <Text style={styles.errorText}>{t('invite.loadError')}</Text>
            <Text style={styles.retry}>{t('common.retry')}</Text>
          </Pressable>
        )}

        {state.kind === 'loaded' && (
          <>
            <Text style={styles.codeLabel}>{t('invite.yourCode')}</Text>
            <Pressable
              style={styles.codeCard}
              onPress={copy}
              accessibilityRole="button"
              accessibilityLabel={`${t('invite.yourCode')} ${code}`}>
              <Text style={styles.code}>{code}</Text>
              <View style={styles.copyPill}>
                <Icon name={copied ? 'check' : 'receipt'} size={16} color={copied ? colors.green : colors.sea} />
                <Text style={[styles.copyText, copied && { color: colors.green }]}>
                  {copied ? t('order.copied') : t('order.copy')}
                </Text>
              </View>
            </Pressable>

            <Pressable style={styles.shareBtn} onPress={share} accessibilityRole="button">
              <Icon name="share" size={20} color={colors.white} />
              <Text style={styles.shareBtnText}>{t('invite.shareCta')}</Text>
            </Pressable>
          </>
        )}

        <View style={styles.steps}>
          <Step n="1" text={t('invite.step1')} />
          <Step n="2" text={t('invite.step2')} />
          <Step n="3" text={t('invite.step3')} />
        </View>
        <Text style={styles.fineprint}>{t('invite.terms')}</Text>
      </View>
    </View>
  );
}

function Step({ n, text }: { n: string; text: string }) {
  return (
    <View style={styles.step}>
      <View style={styles.stepNum}>
        <Text style={styles.stepNumText}>{n}</Text>
      </View>
      <Text style={styles.stepText}>{text}</Text>
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
  body: { flex: 1, paddingHorizontal: 20, paddingTop: 8, gap: 18 },
  hero: { alignItems: 'center', gap: 8, marginTop: 8 },
  giftCircle: {
    width: 84,
    height: 84,
    borderRadius: 42,
    backgroundColor: colors.seaSoft,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadow.card,
  },
  heroTitle: {
    fontSize: font.sizes['4xl'],
    fontWeight: font.weights.extrabold,
    color: colors.ink,
    marginTop: 8,
    textAlign: 'center',
    letterSpacing: -0.3,
  },
  heroSub: { fontSize: font.sizes.lg, color: colors.ink2, textAlign: 'center', lineHeight: 22, paddingHorizontal: 8 },
  codeLabel: {
    fontSize: font.sizes.xs,
    fontWeight: font.weights.bold,
    color: colors.ink2,
    letterSpacing: 1,
    textTransform: 'uppercase',
    textAlign: 'center',
  },
  codeCard: {
    backgroundColor: colors.white,
    borderRadius: radius.xl,
    borderWidth: 1.5,
    borderColor: colors.sea,
    borderStyle: 'dashed',
    paddingVertical: 18,
    alignItems: 'center',
    gap: 10,
    ...shadow.soft,
  },
  code: { fontSize: font.sizes['6xl'], fontWeight: font.weights.extrabold, color: colors.sea, letterSpacing: 2 },
  copyPill: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  copyText: { fontSize: font.sizes.md, fontWeight: font.weights.bold, color: colors.sea },
  shareBtn: {
    backgroundColor: colors.sea,
    borderRadius: radius.lg,
    paddingVertical: 15,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    ...shadow.card,
  },
  shareBtnText: { color: colors.white, fontSize: font.sizes.xl, fontWeight: font.weights.bold },
  steps: { gap: 12, marginTop: 4 },
  step: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  stepNum: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: colors.seaSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepNumText: { fontSize: font.sizes.md, fontWeight: font.weights.extrabold, color: colors.sea },
  stepText: { flex: 1, fontSize: font.sizes.lg, color: colors.ink, lineHeight: 21 },
  fineprint: { fontSize: font.sizes.sm, color: colors.ink3, textAlign: 'center', lineHeight: 18 },
  errorText: { fontSize: font.sizes.lg, color: colors.ink2 },
  retry: { fontSize: font.sizes.lg, fontWeight: font.weights.bold, color: colors.sea },
});
