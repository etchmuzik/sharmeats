import { ActivityIndicator, Text, View } from 'react-native';
import { Redirect } from 'expo-router';
import { useAuth } from '../src/auth';
import { useLocale } from '../src/locale';
import { isSupabaseConfigured } from '../src/supabase';
import { font } from '../src/theme';
import { useThemeColors } from '../src/themeProvider';

export default function Index() {
  const colors = useThemeColors();
  const { session, loading } = useAuth();
  const { t } = useLocale();

  if (!isSupabaseConfigured()) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, backgroundColor: colors.bg }}>
        <Text style={{ fontSize: font.sizes.lg, fontWeight: '700', color: colors.ink, textAlign: 'center' }}>
          {t('boot.backendTitle')}
        </Text>
        <Text style={{ marginTop: 8, color: colors.ink2, textAlign: 'center' }}>
          {t('boot.backendBody')}
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
