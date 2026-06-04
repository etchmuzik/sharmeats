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

export default function SignIn() {
  const router = useRouter();
  const t = useT();
  const [phone, setPhone] = useState('+39 333 ');

  const canSend = phone.replace(/\D/g, '').length >= 8;

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

      <View style={{ flex: 1 }} />

      <View style={{ paddingHorizontal: 24, paddingBottom: 36 }}>
        <PrimaryButton
          label={t('signin.cta')}
          onPress={() => router.replace(`/otp?phone=${encodeURIComponent(phone)}`)}
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
