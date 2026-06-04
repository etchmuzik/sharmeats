import { useEffect } from 'react';
import { View, Text, StyleSheet, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useSession } from '../src/store/session';
import { colors, font } from '../src/theme';

export default function Splash() {
  const router = useRouter();
  const hydrated = useSession((s) => s.hydrated);
  const isSignedIn = useSession((s) => s.isSignedIn);

  useEffect(() => {
    if (!hydrated) return;
    const t = setTimeout(() => {
      if (isSignedIn) router.replace('/(tabs)/home');
      else router.replace('/onboarding');
    }, 350);
    return () => clearTimeout(t);
  }, [hydrated, isSignedIn, router]);

  return (
    <View style={styles.wrap}>
      <StatusBar style="dark" />
      <View style={styles.mark}>
        <Text style={styles.markText}>s</Text>
      </View>
      <Text style={styles.brand}>Sharm Eats</Text>
      <View style={{ marginTop: 28 }}>
        <ActivityIndicator color={colors.accent} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: colors.sand, alignItems: 'center', justifyContent: 'center' },
  mark: {
    width: 80,
    height: 80,
    borderRadius: 22,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 18,
  },
  markText: { color: colors.white, fontSize: 44, fontWeight: font.weights.black, marginTop: -4 },
  brand: { fontSize: font.sizes['8xl'], color: colors.ink, fontWeight: font.weights.bold, letterSpacing: -0.5 },
});
