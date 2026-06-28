import { useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { useRouter } from 'expo-router';
import { BackButton } from '../src/components/BackButton';
import { PrimaryButton } from '../src/components/PrimaryButton';
import { StatusBarSpacer } from '../src/components/StatusBarSpacer';
import { colors, font, radius } from '../src/theme';
import { useT } from '../src/i18n';
import { db } from '../src/data';
import { captureError } from '../src/lib/analytics';

/** Normalize a typed phone to E.164-ish: keep a leading +, strip everything else. */
function toE164(input: string): string {
  const digits = input.replace(/[^\d]/g, '');
  return input.trim().startsWith('+') ? `+${digits}` : `+${digits}`;
}

export default function SignIn() {
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
      setError(e instanceof Error ? e.message : 'Could not send the code. Try again.');
    } finally {
      setSending(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: colors.bg }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <StatusBar style="dark" />
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
          value={phone}
          onChangeText={setPhone}
          keyboardType="phone-pad"
          autoFocus
          placeholder="+20 100 000 0000"
          placeholderTextColor={colors.ink3}
          style={styles.input}
        />
      </View>

      <Text style={styles.terms}>{t('signin.terms')}</Text>

      {error ? (
        <Text style={{ paddingHorizontal: 24, marginTop: 12, color: colors.red, fontSize: font.sizes.md }}>
          {error}
        </Text>
      ) : null}

      <View style={{ flex: 1 }} />

      <View style={{ paddingHorizontal: 24, paddingBottom: 36 }}>
        <PrimaryButton
          label={sending ? t('common.loading') : t('signin.cta')}
          onPress={send}
          disabled={!canSend}
        />
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
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
    backgroundColor: colors.white,
  },
  terms: { paddingHorizontal: 24, marginTop: 20, fontSize: font.sizes.md, color: colors.ink3 },
});
