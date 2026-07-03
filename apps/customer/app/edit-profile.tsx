import { useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BackButton } from '../src/components/BackButton';
import { PrimaryButton } from '../src/components/PrimaryButton';
import { colors, font, radius } from '../src/theme';
import { useT } from '../src/i18n';
import { useDirection } from '../src/lib/direction';
import { success } from '../src/haptics';
import { db } from '../src/data';

// Edit the customer's display name + email. Both are supported by the user repo
// update() but had no UI (audit gap). Keeps onboarding light: name is optional
// at signup, editable here anytime.
export default function EditProfileScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const t = useT();
  const dir = useDirection();

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let active = true;
    db.user
      .getMe()
      .then((me) => {
        if (!active) return;
        setName(me.displayName ?? '');
        setEmail(me.email ?? '');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const save = async () => {
    if (saving) return;
    setSaving(true);
    try {
      await db.user.update({ displayName: name.trim(), email: email.trim() || undefined });
      success();
      router.back();
    } finally {
      setSaving(false);
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <StatusBar style="dark" />
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <BackButton />
        <Text style={styles.headerTitle}>{t('profile.editProfile')}</Text>
        <View style={{ width: 40 }} />
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.accent} />
        </View>
      ) : (
        <ScrollView contentContainerStyle={{ padding: 20, gap: 18 }}>
          <View>
            <Text style={[styles.label, dir.text]}>{t('profile.editName')}</Text>
            <TextInput
              value={name}
              onChangeText={setName}
              placeholder={t('profile.editName')}
              placeholderTextColor={colors.ink3}
              style={[styles.input, dir.text]}
              maxLength={80}
              accessibilityLabel={t('profile.editName')}
            />
          </View>
          <View>
            <Text style={[styles.label, dir.text]}>Email</Text>
            <TextInput
              value={email}
              onChangeText={setEmail}
              placeholder="you@example.com"
              placeholderTextColor={colors.ink3}
              keyboardType="email-address"
              autoCapitalize="none"
              autoComplete="email"
              style={[styles.input, dir.text]}
              maxLength={120}
              accessibilityLabel="Email"
            />
          </View>
          <PrimaryButton label={t('profile.editNameSave')} onPress={save} disabled={saving} />
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 12,
    backgroundColor: colors.white,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  headerTitle: { fontSize: font.sizes['2xl'], fontWeight: font.weights.bold, color: colors.ink },
  label: { fontSize: font.sizes.base, color: colors.ink2, fontWeight: font.weights.semibold, marginBottom: 8 },
  input: {
    borderRadius: radius.lg,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.line,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: font.sizes.lg,
    color: colors.ink,
  },
});
