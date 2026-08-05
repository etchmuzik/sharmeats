import { useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { BackButton } from '../src/components/BackButton';
import { PrimaryButton } from '../src/components/PrimaryButton';
import { StatusBarSpacer } from '../src/components/StatusBarSpacer';
import { font, radius } from '../src/theme';
import { ThemedStatusBar, makeStyles, useThemeColors } from '../src/themeProvider';
import { useT } from '../src/i18n';
import { db } from '../src/data';
import { captureError } from '../src/lib/analytics';
import { customerErrorKey } from '../src/lib/customerError';
import { LEGAL_URLS, openLegal } from '../src/legal';

/** Normalize a typed phone to E.164-ish: keep a leading +, strip everything else. */
function toE164(input: string): string {
  const digits = input.replace(/[^\d]/g, '');
  return input.trim().startsWith('+') ? `+${digits}` : `+${digits}`;
}

export default function SignIn() {
  const colors = useThemeColors();
  const styles = useStyles();
  const router = useRouter();
  const t = useT();
  const [phone, setPhone] = useState('+20 100 ');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSend = phone.replace(/\D/g, '').length >= 8 && !sending;

  const send = async () => {
    const e164 = toE164(phone);
    setSending(true);
    setError(null);
    try {
      await db.auth.sendOtp(e164);
      router.replace(`/otp?phone=${encodeURIComponent(e164)}`);
    } catch (e) {
      captureError(e, { where: 'signin.sendOtp' });
      setError(t(customerErrorKey(e, 'sendOtp')));
    } finally {
      setSending(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: colors.bg }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ThemedStatusBar />
      <StatusBarSpacer />
      <View style={{ paddingHorizontal: 20, paddingTop: 6 }}>
        <BackButton onPress={() => router.replace('/onboarding')} />
      </View>

      <View style={styles.top}>
        <Text style={styles.title}>{t('signin.title')}</Text>
        <Text style={styles.sub}>{t('signin.subtitle')}</Text>
      </View>

      <View style={{ paddingHorizontal: 24, marginTop: 24 }}>
        <TextInput
          testID="customer-phone-input"
          value={phone}
          onChangeText={setPhone}
          keyboardType="phone-pad"
          autoFocus
          placeholder="+20 100 000 0000"
          placeholderTextColor={colors.ink3}
          accessibilityLabel={t('signin.title')}
          style={styles.input}
        />
      </View>

      {/* Tappable consent sentence: the leading copy plus discrete Terms /
          Privacy links that open the live legal pages in the in-app browser. */}
      <Text style={styles.terms}>
        {t('signin.terms')}{' '}
        <Text
          style={styles.termsLink}
          onPress={() => openLegal(LEGAL_URLS.terms)}
          accessibilityRole="link"
          accessibilityLabel={t('legal.terms')}>
          {t('legal.terms')}
        </Text>
        {' · '}
        <Text
          style={styles.termsLink}
          onPress={() => openLegal(LEGAL_URLS.privacy)}
          accessibilityRole="link"
          accessibilityLabel={t('legal.privacy')}>
          {t('legal.privacy')}
        </Text>
      </Text>

      {error ? (
        <Text
          accessibilityRole="alert"
          accessibilityLiveRegion="assertive"
          style={{ paddingHorizontal: 24, marginTop: 12, color: colors.red, fontSize: font.sizes.md }}>
          {error}
        </Text>
      ) : null}

      <View style={{ flex: 1 }} />

      <View style={{ paddingHorizontal: 24, paddingBottom: 36 }}>
        <PrimaryButton
          testID="customer-send-otp"
          label={sending ? t('common.loading') : t('signin.cta')}
          onPress={send}
          disabled={!canSend}
        />
      </View>
    </KeyboardAvoidingView>
  );
}

const useStyles = makeStyles((colors) => ({
  top: { paddingHorizontal: 24, paddingTop: 14 },
  title: {
    fontSize: font.sizes['10xl'],
    fontWeight: font.weights.extrabold,
    letterSpacing: -1,
    marginBottom: 10,
    color: colors.ink,
  },
  sub: { fontSize: font.sizes.xl, color: colors.ink2, lineHeight: 22 },
  input: {
    borderWidth: 1.5,
    borderColor: colors.line,
    borderRadius: radius.lg,
    paddingHorizontal: 18,
    paddingVertical: 16,
    fontSize: font.sizes['4xl'],
    color: colors.ink,
    fontWeight: font.weights.semibold,
    backgroundColor: colors.surface,
  },
  terms: { paddingHorizontal: 24, marginTop: 20, fontSize: font.sizes.md, color: colors.ink3 },
  termsLink: { color: colors.sea, fontWeight: font.weights.semibold },
}));
