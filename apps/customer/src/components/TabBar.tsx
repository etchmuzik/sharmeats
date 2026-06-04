import { useEffect, useRef } from 'react';
import { Animated, View, Pressable, Text, StyleSheet } from 'react-native';
import { useRouter, usePathname } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, font } from '../theme';
import { selection } from '../haptics';
import { useCart } from '../store/cart';
import { useT } from '../i18n';

type TabKey = 'home' | 'browse' | 'cart' | 'orders' | 'profile';

const TABS: { key: TabKey; icon: string; tKey: string; path: string }[] = [
  { key: 'home', icon: '🏠', tKey: 'tabs.home', path: '/(tabs)/home' },
  { key: 'browse', icon: '🔍', tKey: 'tabs.browse', path: '/(tabs)/browse' },
  { key: 'cart', icon: '🛒', tKey: 'tabs.cart', path: '/(tabs)/cart' },
  { key: 'orders', icon: '🧾', tKey: 'tabs.orders', path: '/(tabs)/orders' },
  { key: 'profile', icon: '👤', tKey: 'tabs.profile', path: '/(tabs)/profile' },
];

export function TabBar() {
  const router = useRouter();
  const pathname = usePathname();
  const insets = useSafeAreaInsets();
  const cartCount = useCart((s) => s.count());
  const t = useT();
  const scale = useRef(new Animated.Value(1)).current;
  const prevCount = useRef(cartCount);

  useEffect(() => {
    if (cartCount > prevCount.current) {
      Animated.sequence([
        Animated.spring(scale, { toValue: 1.35, useNativeDriver: true, friction: 4 }),
        Animated.spring(scale, { toValue: 1, useNativeDriver: true, friction: 4 }),
      ]).start();
    }
    prevCount.current = cartCount;
  }, [cartCount, scale]);

  return (
    <View
      style={[
        styles.wrap,
        {
          paddingBottom: Math.max(insets.bottom, 12),
          borderTopWidth: 1,
        },
      ]}>
      {TABS.map((tab) => {
        const active = pathname.includes(tab.key);
        return (
          <Pressable
            key={tab.key}
            onPress={() => {
              if (!active) selection();
              router.replace(tab.path as never);
            }}
            style={styles.tab}>
            <View>
              <Text style={[styles.icon, !active && { opacity: 0.5 }]}>{tab.icon}</Text>
              {tab.key === 'cart' && cartCount > 0 && (
                <Animated.View style={[styles.badge, { transform: [{ scale }] }]}>
                  <Text style={styles.badgeText}>{cartCount}</Text>
                </Animated.View>
              )}
            </View>
            <Text style={[styles.label, active && styles.labelActive]}>{t(tab.tKey)}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'space-around',
    backgroundColor: 'rgba(255,255,255,0.98)',
    borderTopColor: colors.line,
    paddingTop: 10,
  },
  tab: { alignItems: 'center', paddingHorizontal: 14, paddingVertical: 4 },
  icon: { fontSize: 22, marginBottom: 3 },
  label: { fontSize: font.sizes.xs, fontWeight: font.weights.semibold, color: colors.ink3 },
  labelActive: { color: colors.accent },
  badge: {
    position: 'absolute',
    top: -4,
    right: -10,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 5,
  },
  badgeText: { color: colors.white, fontSize: 10, fontWeight: font.weights.bold },
});
