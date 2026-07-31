import { ActivityIndicator, Text, View } from 'react-native';
import { Redirect } from 'expo-router';
import { useAuth } from '../src/auth';
import { isSupabaseConfigured } from '../src/supabase';
import { font } from '../src/theme';
import { useThemeColors } from '../src/themeProvider';
import { useLocale } from '../src/locale';

export default function Index() {
  const colors = useThemeColors();
  const { direction, t } = useLocale();
  const { session, loading } = useAuth();

  if (!isSupabaseConfigured()) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, backgroundColor: colors.bg, direction }}>
        <Text style={{ fontSize: font.sizes.lg, fontWeight: '700', color: colors.ink, textAlign: 'center' }}>
          {t('boot.notConfiguredTitle')}
        </Text>
        {/* The env-var NAMES stay verbatim in both locales — they are what the
            person fixing this has to type. */}
        <Text style={{ marginTop: 8, color: colors.ink2, textAlign: 'center' }}>
          {t('boot.notConfiguredBody')}
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
