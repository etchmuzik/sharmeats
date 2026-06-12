import { useEffect, useRef, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { PrimaryButton } from '../src/components/PrimaryButton';
import { BackButton } from '../src/components/BackButton';
import { StatusBarSpacer } from '../src/components/StatusBarSpacer';
import { colors, font, radius } from '../src/theme';
import { useT } from '../src/i18n';
import { useSession } from '../src/store/session';
import { success } from '../src/haptics';
import { registerForPush } from '../src/lib/push';

const LEN = 6;

export default function Otp() {
  const router = useRouter();
  const t = useT();
  const params = useLocalSearchParams<{ phone?: string }>();
  const signIn = useSession((s) => s.signIn);
  const phoneDisplay = params.phone ?? '+20 100 123 4567';

  const [code, setCode] = useState('');
  const input = useRef<TextInput>(null);
  const [seconds, setSeconds] = useState(42);

  useEffect(() => {
    if (seconds <= 0) return;
    const tt = setInterval(() => setSeconds((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(tt);
  }, [seconds]);

  const focusedIdx = code.length;
  const digits = Array.from({ length: LEN }, (_, i) => code[i] ?? '');

  const verify = () => {
    success();
    signIn(phoneDisplay);
    // Best-effort, fire-and-forget: ask for push permission now that the user
    // has an account worth notifying (order status updates).
    registerForPush();
    router.replace('/(tabs)/home');
  };

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: colors.bg }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <StatusBar style="dark" />
      <StatusBarSpacer />
      <View style={{ paddingHorizontal: 20, paddingTop: 6 }}>
        <BackButton onPress={() => router.replace('/signin')} />
      </View>

      <View style={styles.top}>
        <Text style={styles.title}>{t('otp.title')}</Text>
        <Text style={styles.sub}>
          {t('otp.subtitle')}
          {'\n'}
          <Text style={{ fontWeight: font.weights.bold, color: colors.ink }}>{phoneDisplay}</Text>
          {'  ·  '}
          <Text
            onPress={() => router.replace('/signin')}
            style={{ color: colors.accent, fontWeight: font.weights.semibold }}>
            {t('otp.edit')}
          </Text>
        </Text>
      </View>

      <Pressable style={styles.boxes} onPress={() => input.current?.focus()}>
        {digits.map((d, i) => (
          <View
            key={i}
            style={[styles.box, d ? styles.boxFilled : null, i === focusedIdx ? styles.boxActive : null]}>
            <Text style={styles.boxDigit}>{d}</Text>
          </View>
        ))}
        <TextInput
          ref={input}
          value={code}
          onChangeText={(txt) => {
            const next = txt.replace(/\D/g, '').slice(0, LEN);
            setCode(next);
            if (next.length === LEN) setTimeout(verify, 220);
          }}
          keyboardType="number-pad"
          maxLength={LEN}
          autoFocus
          caretHidden
          style={styles.hiddenInput}
        />
      </Pressable>

      <Text style={styles.resend}>
        Didn't receive?{' '}
        <Text
          onPress={() => seconds <= 0 && setSeconds(42)}
          style={{ color: colors.accent, fontWeight: font.weights.bold }}>
          {seconds > 0
            ? t('otp.resendCountdown', { seconds: seconds.toString().padStart(2, '0') })
            : t('otp.resendNow')}
        </Text>
      </Text>

      <View style={{ flex: 1 }} />

      <View style={{ paddingHorizontal: 24, paddingBottom: 36 }}>
        <PrimaryButton label={t('otp.cta')} onPress={verify} />
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
  boxes: { flexDirection: 'row', gap: 10, justifyContent: 'center', paddingVertical: 32 },
  box: {
    width: 48,
    height: 56,
    borderWidth: 1.5,
    borderColor: colors.line,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.white,
  },
  boxFilled: { borderColor: colors.ink, backgroundColor: colors.sand },
  boxActive: { borderColor: colors.accent },
  boxDigit: { fontSize: font.sizes['5xl'], fontWeight: font.weights.bold, color: colors.ink },
  hiddenInput: { position: 'absolute', opacity: 0, width: 1, height: 1 },
  resend: { textAlign: 'center', fontSize: font.sizes.base, color: colors.ink2, paddingHorizontal: 24 },
});
