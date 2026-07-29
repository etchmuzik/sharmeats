import { useEffect } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { Redirect } from 'expo-router';
import { useAuth } from '../src/auth';
import { isSupabaseConfigured } from '../src/supabase';
import { font } from '../src/theme';
import { useThemeColors } from '../src/themeProvider';

export default function Index() {
  const colors = useThemeColors();
  const { session, loading } = useAuth();

  if (!isSupabaseConfigured()) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, backgroundColor: colors.bg }}>
        <Text style={{ fontSize: font.sizes.lg, fontWeight: '700', color: colors.ink, textAlign: 'center' }}>
          Backend not configured
        </Text>
        <Text style={{ marginTop: 8, color: colors.ink2, textAlign: 'center' }}>
          Set EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY, then restart.
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
