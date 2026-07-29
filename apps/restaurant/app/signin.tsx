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
import { font, radius, spacing } from '../src/theme';
import { makeStyles, useThemeColors } from '../src/themeProvider';
import { LEGAL_URLS, openLegal } from '../src/legal';

export default function SignIn() {
  const colors = useThemeColors();
  const styles = useSigninStyles();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { signInWithPassword } = useAuth();
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
      setError(e instanceof Error ? e.message : 'Could not sign in');
    } finally {
      setBusy(false);
    }
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={{ flex: 1, backgroundColor: colors.accent }}
    >
      {/* Deliberately NOT ThemedStatusBar: this gate is a full-bleed violet
          hero in BOTH themes (`accent` does not invert), so the glyphs above it
          must stay light either way. */}
      <StatusBar style="light" />
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ flexGrow: 1, justifyContent: 'flex-end', paddingTop: insets.top + 40 }}
      >
        <View style={{ paddingHorizontal: spacing.xxl, paddingBottom: spacing.xxxl }}>
          <Text style={{ color: colors.onAccent, fontSize: font.sizes.huge, fontWeight: '800' }}>
            Sharm Eats
          </Text>
          {/* onAccent, not accentSoft: this hero is filled with `accent`, identical in
              both themes, so its label must be too — accentSoft inverts to a
              near-black violet. Hierarchy comes from 36px/800 vs 16px/regular. */}
          <Text style={{ color: colors.onAccent, fontSize: font.sizes.lg, marginTop: 4 }}>
            Restaurant
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
          <Text style={{ fontSize: font.sizes.xl, fontWeight: '700', color: colors.ink }}>
            Sign in
          </Text>
          <Text style={{ color: colors.ink2 }}>
            Use your restaurant email and password (same as the web dashboard).
          </Text>
          <Text style={styles.fieldLabel}>Restaurant email</Text>
          <TextInput
            testID="restaurant-email-input"
            value={email}
            onChangeText={setEmail}
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
            textContentType="username"
            placeholder="owner@restaurant.com"
            placeholderTextColor={colors.ink3}
            accessibilityLabel="Restaurant email"
            style={styles.input}
          />
          <Text style={styles.fieldLabel}>Password</Text>
          <TextInput
            testID="restaurant-password-input"
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            textContentType="password"
            placeholder="Password"
            placeholderTextColor={colors.ink3}
            accessibilityLabel="Password"
            style={styles.input}
            onSubmitEditing={() => email && password && submit()}
          />
          <Pressable
            testID="restaurant-signin-button"
            onPress={submit}
            disabled={busy || !email || !password}
            accessibilityRole="button"
            accessibilityLabel="Sign in"
            accessibilityState={{ disabled: busy || !email || !password, busy }}
            style={[styles.btn, (busy || !email || !password) && { opacity: 0.5 }]}
          >
            {busy ? <ActivityIndicator color={colors.onAccent} /> : <Text style={styles.btnText}>Sign in</Text>}
          </Pressable>

          {error && (
            <View accessibilityRole="alert" style={{ backgroundColor: colors.redSoft, borderRadius: radius.md, padding: spacing.md }}>
              <Text style={{ color: colors.redText, fontSize: font.sizes.sm }}>{error}</Text>
            </View>
          )}

          <Pressable
            onPress={() => Linking.openURL('https://merchant.sharmeats.online/login')}
            accessibilityRole="link"
            accessibilityLabel="Reset your password on the merchant dashboard"
            style={helpLink}
          >
            <Text style={styles.helpLinkText}>Forgot your password? Reset it on the dashboard</Text>
          </Pressable>

          <Text style={{ marginTop: spacing.sm, fontSize: font.sizes.sm, color: colors.ink3, textAlign: 'center' }}>
            By continuing you agree to our{' '}
            <Text
              style={{ color: colors.accentText, fontWeight: '600' }}
              onPress={() => openLegal(LEGAL_URLS.terms)}
              accessibilityRole="link"
              accessibilityLabel="Terms of Service"
            >
              Terms of Service
            </Text>
            {' · '}
            <Text
              style={{ color: colors.accentText, fontWeight: '600' }}
              onPress={() => openLegal(LEGAL_URLS.privacy)}
              accessibilityRole="link"
              accessibilityLabel="Privacy Policy"
            >
              Privacy Policy
            </Text>
          </Text>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const helpLink = {
  minHeight: 44,
  alignItems: 'center',
  justifyContent: 'center',
} as const;

/**
 * These were module-scope constants, which is exactly the pattern that cannot
 * survive a theme switch: the palette values were copied in at import time.
 */
const useSigninStyles = makeStyles((colors) => ({
  input: {
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.lg,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    fontSize: font.sizes.lg,
    color: colors.ink,
    backgroundColor: colors.surface,
  },
  fieldLabel: {
    color: colors.ink,
    fontSize: font.sizes.sm,
    fontWeight: '700',
    marginBottom: -spacing.sm,
  },
  helpLinkText: {
    color: colors.accentDark,
    fontSize: font.sizes.sm,
    fontWeight: '700',
    textAlign: 'center',
  },
  btn: {
    backgroundColor: colors.accent,
    borderRadius: radius.lg,
    paddingVertical: spacing.lg,
    alignItems: 'center',
  },
  btnText: {
    color: colors.onAccent,
    fontSize: font.sizes.lg,
    fontWeight: '700',
  },
}));
