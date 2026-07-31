import { useEffect, useRef, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { PrimaryButton } from '../src/components/PrimaryButton';
import { BackButton } from '../src/components/BackButton';
import { StatusBarSpacer } from '../src/components/StatusBarSpacer';
import { font, radius } from '../src/theme';
import { ThemedStatusBar, makeStyles, useThemeColors } from '../src/themeProvider';
import { useT } from '../src/i18n';
import { useSession } from '../src/store/session';
import { success } from '../src/haptics';
import { registerForPush } from '../src/lib/push';
import { syncFavoritesFromServer } from '../src/lib/favorites';
import { db } from '../src/data';
import { captureError } from '../src/lib/analytics';
import { authErrorKey } from '../src/lib/authErrors';
import { syncProfilePreferences } from '../src/lib/profilePrefs';

const LEN = 6;

export default function Otp() {
  const colors = useThemeColors();
  const styles = useStyles();
  const router = useRouter();
  const t = useT();
  const params = useLocalSearchParams<{ phone?: string }>();
  const signIn = useSession((s) => s.signIn);
  const phoneDisplay = params.phone ?? '+20 100 123 4567';

  const [code, setCode] = useState('');
  const input = useRef<TextInput>(null);
  const [seconds, setSeconds] = useState(42);
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (seconds <= 0) return;
    const tt = setInterval(() => setSeconds((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(tt);
  }, [seconds]);

  const focusedIdx = code.length;
  const digits = Array.from({ length: LEN }, (_, i) => code[i] ?? '');

  const verify = async () => {
    if (verifying || code.length !== LEN) return;
    setVerifying(true);
    setError(null);
    try {
      // Real verification: links the phone to the (anonymous) session, so order
      // history is preserved. Only on success do we flip the local UI flag.
      const { phone } = await db.auth.verifyOtp(phoneDisplay, code);
      success();
      signIn(phone);
      // Merge favourites for the account we just landed in. This is the moment
      // the identity can CHANGE: verifying a phone that already has an account
      // swaps auth.uid(), so the guest's saved restaurants exist only on this
      // device. Merging here (rather than waiting for the next cold start)
      // uploads them before anything else can overwrite local state.
      // Not awaited — a slow network must not hold up the redirect.
      syncFavoritesFromServer();
      // Persist the app language + currency onto the profile row. users.locale
      // defaults to 'ar' at signup and no client ever wrote it, so every push
      // notification rendered in Arabic regardless of the language the customer
      // is actually reading the app in. Best-effort, not awaited.
      syncProfilePreferences();
      // Best-effort: ask for push permission now there's an account to notify.
      registerForPush();
      router.replace('/(tabs)/home');
    } catch (e) {
      // Raw provider text never reaches the screen — see lib/authErrors.
      captureError(e, { where: 'otp.verify' });
      setError(t(authErrorKey(e, 'error.otpInvalid')));
      setCode('');
    } finally {
      setVerifying(false);
    }
  };

  const resend = async () => {
    if (seconds > 0) return;
    setError(null);
    try {
      await db.auth.sendOtp(phoneDisplay);
      setSeconds(42);
    } catch (e) {
      captureError(e, { where: 'otp.resend' });
      setError(t(authErrorKey(e, 'error.otpResendFailed')));
    }
  };

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: colors.bg }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ThemedStatusBar />
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
          testID="customer-otp-input"
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
        {t('otp.resendPrompt')}{' '}
        <Text
          onPress={resend}
          style={{ color: colors.accent, fontWeight: font.weights.bold }}>
          {seconds > 0
            ? t('otp.resendCountdown', { seconds: seconds.toString().padStart(2, '0') })
            : t('otp.resendNow')}
        </Text>
      </Text>

      {error ? (
        <Text style={{ color: colors.red, textAlign: 'center', paddingHorizontal: 24, marginTop: 8 }}>
          {error}
        </Text>
      ) : null}

      <View style={{ flex: 1 }} />

      <View style={{ paddingHorizontal: 24, paddingBottom: 36 }}>
        <PrimaryButton testID="customer-verify-otp" label={t('otp.cta')} onPress={verify} />
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
  boxes: { flexDirection: 'row', gap: 10, justifyContent: 'center', paddingVertical: 32 },
  box: {
    width: 48,
    height: 56,
    borderWidth: 1.5,
    borderColor: colors.line,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
  },
  boxFilled: { borderColor: colors.ink, backgroundColor: colors.sand },
  boxActive: { borderColor: colors.accent },
  boxDigit: { fontSize: font.sizes['5xl'], fontWeight: font.weights.bold, color: colors.ink },
  hiddenInput: { position: 'absolute', opacity: 0, width: 1, height: 1 },
  resend: { textAlign: 'center', fontSize: font.sizes.base, color: colors.ink2, paddingHorizontal: 24 },
}));
