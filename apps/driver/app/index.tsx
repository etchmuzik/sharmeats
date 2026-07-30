import { useEffect } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { Redirect } from 'expo-router';
import { useAuth } from '../src/auth';
import { isSupabaseConfigured } from '../src/supabase';
import { font } from '../src/theme';
import { useThemeColors } from '../src/themeProvider';
import { useI18n } from '../src/i18n-context';

export default function Index() {
  const colors = useThemeColors();
  const { session, loading } = useAuth();
  const { direction, t } = useI18n();

  if (!isSupabaseConfigured()) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, backgroundColor: colors.bg }}>
        <Text style={{ fontSize: font.sizes.lg, fontWeight: '700', color: colors.ink, textAlign: 'center', writingDirection: direction.writingDirection }}>
          {t('index.backendTitle')}
        </Text>
        <Text style={{ marginTop: 8, color: colors.ink2, textAlign: 'center', writingDirection: direction.writingDirection }}>
          {t('index.backendBody')}
        </Text>
      </View>
    );
  }

  if (loading) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg }}>
        <ActivityIndicator color={colors.accent} size="large" />
      </View>
    );
  }

  return <Redirect href={session ? '/home' : '/signin'} />;
}
