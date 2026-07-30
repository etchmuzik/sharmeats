import { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../src/auth';
import { colors, font, radius, spacing } from '../src/theme';
import { LEGAL_URLS, openLegal } from '../src/legal';
import { LanguageToggle } from '../src/components/LanguageToggle';
import { useI18n } from '../src/i18n-context';
import { captureError } from '../src/lib/crash';

export default function SignIn() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { signInWithPassword } = useAuth();
  const { direction, errorMessage, t } = useI18n();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await signInWithPassword(email, password);
      router.replace('/home');
    } catch (e) {
      captureError(e, { where: 'driver.signin' });
      setError(errorMessage('signin', e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={{ flex: 1, backgroundColor: colors.accent }}
    >
      <StatusBar style="light" />
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{
          flexGrow: 1,
          justifyContent: 'flex-end',
          paddingTop: insets.top + 40,
          direction: direction.direction,
        }}
      >
        <View style={{ paddingHorizontal: spacing.xxl, paddingBottom: spacing.xxxl }}>
          <LanguageToggle inverted />
          <Text style={{ color: colors.white, fontSize: font.sizes.huge, fontWeight: '800' }}>
            Sharm Eats
          </Text>
          <Text
            style={{
              color: colors.accentSoft,
              fontSize: font.sizes.lg,
              marginTop: 4,
              textAlign: direction.textAlign,
              writingDirection: direction.writingDirection,
            }}
          >
            {t('signin.driver')}
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
          <Text
            style={{
              fontSize: font.sizes.xl,
              fontWeight: '700',
              color: colors.ink,
              textAlign: direction.textAlign,
              writingDirection: direction.writingDirection,
            }}
          >
            {t('signin.title')}
          </Text>
          <Text style={{ color: colors.ink2, textAlign: direction.textAlign, writingDirection: direction.writingDirection }}>{t('signin.subtitle')}</Text>
          <Text style={[fieldLabel, { textAlign: direction.textAlign, writingDirection: direction.writingDirection }]}>{t('signin.email')}</Text>
          <TextInput
            testID="driver-email-input"
            value={email}
            onChangeText={setEmail}
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
            textContentType="username"
            placeholder="driver@sharmeats.eg"
            placeholderTextColor={colors.ink3}
            accessibilityLabel={t('signin.email')}
            style={[inputStyle, { textAlign: 'left', writingDirection: 'ltr' }]}
          />
          <Text style={[fieldLabel, { textAlign: direction.textAlign, writingDirection: direction.writingDirection }]}>{t('signin.password')}</Text>
          <TextInput
            testID="driver-password-input"
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            textContentType="password"
            placeholder={t('signin.password')}
            placeholderTextColor={colors.ink3}
            accessibilityLabel={t('signin.password')}
            style={[inputStyle, { textAlign: 'left', writingDirection: 'ltr' }]}
            onSubmitEditing={() => email && password && submit()}
          />
          <Pressable
            testID="driver-signin-button"
            onPress={submit}
            disabled={busy || !email || !password}
            accessibilityRole="button"
            accessibilityLabel={t('signin.submit')}
            accessibilityState={{ disabled: busy || !email || !password, busy }}
            style={[btnStyle, (busy || !email || !password) && { opacity: 0.5 }]}
          >
            {busy ? (
              <ActivityIndicator color={colors.white} />
            ) : (
              <Text style={btnText}>{t('signin.submit')}</Text>
            )}
          </Pressable>

          {error && (
            <View accessibilityRole="alert" style={{ backgroundColor: colors.redSoft, borderRadius: radius.md, padding: spacing.md }}>
              <Text style={{ color: colors.red, fontSize: font.sizes.sm }}>{error}</Text>
            </View>
          )}

          <Pressable
            onPress={() =>
              Linking.openURL(
                'mailto:support@sharmeats.online?subject=Driver%20app%20access%20help',
              )
            }
            accessibilityRole="link"
            accessibilityLabel={t('signin.helpA11y')}
            style={helpLink}
          >
            <Text style={[helpLinkText, { writingDirection: direction.writingDirection }]}>{t('signin.help')}</Text>
          </Pressable>

          <Text style={{ marginTop: spacing.sm, fontSize: font.sizes.sm, color: colors.ink3, textAlign: 'center', writingDirection: direction.writingDirection }}>
            {t('signin.agreementPrefix')}{' '}
            <Text
              style={{ color: colors.accent, fontWeight: '600' }}
              onPress={() => openLegal(LEGAL_URLS.terms)}
              accessibilityRole="link"
              accessibilityLabel={t('signin.terms')}
            >
              {t('signin.terms')}
            </Text>
            {' · '}
            <Text
              style={{ color: colors.accent, fontWeight: '600' }}
              onPress={() => openLegal(LEGAL_URLS.privacy)}
              accessibilityRole="link"
              accessibilityLabel={t('signin.privacy')}
            >
              {t('signin.privacy')}
            </Text>
          </Text>
        </View>
      </ScrollView>
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

const fieldLabel = {
  color: colors.ink,
  fontSize: font.sizes.sm,
  fontWeight: '700',
  marginBottom: -spacing.sm,
} as const;

const helpLink = {
  minHeight: 44,
  alignItems: 'center',
  justifyContent: 'center',
} as const;

const helpLinkText = {
  color: colors.accentDark,
  fontSize: font.sizes.sm,
  fontWeight: '700',
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
