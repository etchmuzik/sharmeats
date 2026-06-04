import { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../src/auth';
import { colors, font, radius, spacing } from '../src/theme';

export default function SignIn() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { sendPhoneOtp, verifyPhoneOtp } = useAuth();
  const [phase, setPhase] = useState<'phone' | 'otp'>('phone');
  const [phone, setPhone] = useState('+20');
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send() {
    setBusy(true);
    setError(null);
    try {
      await sendPhoneOtp(phone.trim());
      setPhase('otp');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not send code');
    } finally {
      setBusy(false);
    }
  }

  async function verify() {
    setBusy(true);
    setError(null);
    try {
      await verifyPhoneOtp(phone.trim(), token.trim());
      router.replace('/home');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Invalid code');
    } finally {
      setBusy(false);
    }
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={{ flex: 1, backgroundColor: colors.accent }}
    >
      <View style={{ flex: 1, justifyContent: 'flex-end', paddingTop: insets.top + 40 }}>
        <View style={{ paddingHorizontal: spacing.xxl, paddingBottom: spacing.xxxl }}>
          <Text style={{ color: colors.white, fontSize: font.sizes.huge, fontWeight: '800' }}>
            Sharm Eats
          </Text>
          <Text style={{ color: colors.accentSoft, fontSize: font.sizes.lg, marginTop: 4 }}>
            Driver
          </Text>
        </View>

        <View
          style={{
            backgroundColor: colors.bg,
            borderTopLeftRadius: 28,
            borderTopRightRadius: 28,
            padding: spacing.xxl,
            paddingBottom: insets.bottom + spacing.xxl,
            gap: spacing.md,
          }}
        >
          {phase === 'phone' ? (
            <>
              <Text style={{ fontSize: font.sizes.xl, fontWeight: '700', color: colors.ink }}>
                Sign in
              </Text>
              <Text style={{ color: colors.ink2 }}>Enter your registered phone number.</Text>
              <TextInput
                value={phone}
                onChangeText={setPhone}
                keyboardType="phone-pad"
                placeholder="+20 10 1234 5678"
                placeholderTextColor={colors.ink3}
                style={inputStyle}
              />
              <Pressable
                onPress={send}
                disabled={busy || phone.length < 8}
                style={[btnStyle, (busy || phone.length < 8) && { opacity: 0.5 }]}
              >
                {busy ? (
                  <ActivityIndicator color={colors.white} />
                ) : (
                  <Text style={btnText}>Send code</Text>
                )}
              </Pressable>
            </>
          ) : (
            <>
              <Text style={{ fontSize: font.sizes.xl, fontWeight: '700', color: colors.ink }}>
                Enter code
              </Text>
              <Text style={{ color: colors.ink2 }}>Sent to {phone}</Text>
              <TextInput
                value={token}
                onChangeText={setToken}
                keyboardType="number-pad"
                placeholder="123456"
                placeholderTextColor={colors.ink3}
                style={[inputStyle, { letterSpacing: 8, textAlign: 'center', fontSize: 22 }]}
              />
              <Pressable
                onPress={verify}
                disabled={busy || token.length < 6}
                style={[btnStyle, (busy || token.length < 6) && { opacity: 0.5 }]}
              >
                {busy ? (
                  <ActivityIndicator color={colors.white} />
                ) : (
                  <Text style={btnText}>Sign in</Text>
                )}
              </Pressable>
              <Pressable onPress={() => setPhase('phone')} style={{ alignItems: 'center', padding: 8 }}>
                <Text style={{ color: colors.ink3 }}>Change number</Text>
              </Pressable>
            </>
          )}

          {error && (
            <View style={{ backgroundColor: colors.redSoft, borderRadius: radius.md, padding: spacing.md }}>
              <Text style={{ color: colors.red, fontSize: font.sizes.sm }}>{error}</Text>
            </View>
          )}
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

const inputStyle = {
  borderWidth: 1,
  borderColor: colors.line,
  borderRadius: radius.lg,
  paddingHorizontal: spacing.lg,
  paddingVertical: spacing.md,
  fontSize: font.sizes.lg,
  color: colors.ink,
  backgroundColor: colors.white,
} as const;

const btnStyle = {
  backgroundColor: colors.accent,
  borderRadius: radius.lg,
  paddingVertical: spacing.lg,
  alignItems: 'center',
} as const;

const btnText = {
  color: colors.white,
  fontSize: font.sizes.lg,
  fontWeight: '700',
} as const;
