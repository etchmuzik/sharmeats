import { useEffect, useRef } from 'react';
import { Animated, View, Text, StyleSheet } from 'react-native';
import { useRouter, usePathname } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, font, radius, shadow } from '../theme';
import { selection } from '../haptics';
import { useCart } from '../store/cart';
import { useUnreadBadges } from '../hooks/useUnreadBadges';
import { useT } from '../i18n';
import { Icon, type IconName } from './Icon';
import { PressableScale } from './PressableScale';

type TabKey = 'home' | 'browse' | 'cart' | 'orders' | 'rewards' | 'profile';

const TABS: { key: TabKey; icon: IconName; tKey: string; path: string }[] = [
  { key: 'home', icon: 'home', tKey: 'tabs.home', path: '/(tabs)/home' },
  { key: 'browse', icon: 'search', tKey: 'tabs.browse', path: '/(tabs)/browse' },
  { key: 'cart', icon: 'cart', tKey: 'tabs.cart', path: '/(tabs)/cart' },
  { key: 'orders', icon: 'receipt', tKey: 'tabs.orders', path: '/(tabs)/orders' },
  { key: 'rewards', icon: 'gift', tKey: 'tabs.rewards', path: '/(tabs)/rewards' },
  { key: 'profile', icon: 'person', tKey: 'tabs.profile', path: '/(tabs)/profile' },
];

/**
 * App v2 floating pill nav: a dark rounded bar hovering above the bottom edge;
 * the active tab sits in a white pill with its label, inactive tabs are
 * icon-only. Pure restyle of the v1 bar — routing, haptics and the cart /
 * unread badges are unchanged.
 */
export function TabBar() {
  const router = useRouter();
  const pathname = usePathname();
  const insets = useSafeAreaInsets();
  const cartCount = useCart((s) => s.count());
  const unread = useUnreadBadges();
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
    <View style={[styles.wrap, { bottom: Math.max(insets.bottom, 14) }]}>
      {TABS.map((tab) => {
        const active = pathname.includes(tab.key);
        return (
          <PressableScale
            key={tab.key}
            haptic="none"
            onPress={() => {
              if (!active) selection();
              router.replace(tab.path as never);
            }}
            style={active ? styles.tabOn : styles.tab}>
            <View>
              <View style={active ? undefined : styles.iconDim}>
                <Icon name={tab.icon} active={active} size={22} color={active ? colors.inkDeep : colors.white} />
              </View>
              {tab.key === 'cart' && cartCount > 0 && (
                <Animated.View style={[styles.badge, { transform: [{ scale }] }]}>
                  <Text style={styles.badgeText}>{cartCount}</Text>
                </Animated.View>
              )}
              {tab.key === 'orders' && unread.orders > 0 && (
                <View style={styles.badge} accessibilityLabel={`${unread.orders} unread order messages`}>
                  <Text style={styles.badgeText}>{unread.orders}</Text>
                </View>
              )}
              {tab.key === 'profile' && unread.support > 0 && (
                <View style={styles.badge} accessibilityLabel={`${unread.support} unread support replies`}>
                  <Text style={styles.badgeText}>{unread.support}</Text>
                </View>
              )}
            </View>
            {active && <Text style={styles.labelOn}>{t(tab.tKey)}</Text>}
          </PressableScale>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: 14,
    right: 14,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.inkDeep,
    borderRadius: radius.pill,
    padding: 6,
    ...shadow.nav,
  },
  tab: {
    flex: 1,
    height: 52,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabOn: {
    height: 52,
    borderRadius: radius.pill,
    backgroundColor: colors.white,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 18,
  },
  iconDim: { opacity: 0.45 },
  labelOn: {
    fontSize: font.sizes.base,
    fontWeight: font.weights.extrabold,
    color: colors.inkDeep,
  },
  badge: {
    position: 'absolute',
    top: -4,
    right: -10,
    minWidth: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 5,
  },
  badgeText: { color: colors.white, fontSize: font.sizes.xs, fontWeight: font.weights.bold },
});
