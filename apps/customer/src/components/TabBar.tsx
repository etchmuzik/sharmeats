import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Easing, View, Text } from 'react-native';
import { useRouter, usePathname } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { font, radius, shadow } from '../theme';
import { makeStyles, useThemeColors } from '../themeProvider';
import { selection } from '../haptics';
import { useCart } from '../store/cart';
import { useUnreadBadges } from '../hooks/useUnreadBadges';
import { formatLocalizedNumber, useT } from '../i18n';
import { MAIN_TABS, mainTabKeyForPath } from '../navigation/mainNavigation';
import { Icon } from './Icon';
import { PressableScale } from './PressableScale';
import { useSession } from '../store/session';

export const CART_BADGE_FEEDBACK = {
  peakScale: 1.08,
  riseDurationMs: 80,
  settleDurationMs: 120,
} as const;

export function shouldAnimateCartBadge(
  previousCount: number,
  currentCount: number,
  reduceMotion: boolean,
): boolean {
  return currentCount > previousCount && !reduceMotion;
}

/**
 * App v2 floating pill nav: a dark rounded bar hovering above the bottom edge;
 * the active tab sits in a white pill, all tabs icon-only. Labels were dropped
 * (owner call, 2026-08-03): the active pill grew with its label, and long
 * translations squeezed the other four tabs on narrow phones — worst in
 * Arabic, where the bar visibly jumped on every tab change. Icon-only makes
 * every tab equal width and the bar geometry constant. The label text still
 * exists for screen readers via accessibilityLabel, which is why removing the
 * visible text costs no accessibility.
 */
export function TabBar() {
  const colors = useThemeColors();
  const styles = useStyles();
  const router = useRouter();
  const pathname = usePathname();
  const insets = useSafeAreaInsets();
  const cartCount = useCart((s) => s.count());
  const unread = useUnreadBadges();
  const t = useT();
  const locale = useSession((s) => s.locale);
  const scale = useRef(new Animated.Value(1)).current;
  const prevCount = useRef(cartCount);
  const [reduceMotion, setReduceMotion] = useState(true);
  const activeKey = mainTabKeyForPath(pathname);

  useEffect(() => {
    let active = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((enabled) => {
        if (active) setReduceMotion(enabled);
      })
      .catch(() => {
        if (active) setReduceMotion(false);
      });

    const subscription = AccessibilityInfo.addEventListener(
      'reduceMotionChanged',
      (enabled) => setReduceMotion(enabled),
    );
    return () => {
      active = false;
      subscription.remove();
    };
  }, []);

  useEffect(() => {
    if (!reduceMotion) return;
    scale.stopAnimation();
    scale.setValue(1);
  }, [reduceMotion, scale]);

  useEffect(() => {
    if (shouldAnimateCartBadge(prevCount.current, cartCount, reduceMotion)) {
      scale.stopAnimation();
      scale.setValue(1);
      Animated.sequence([
        Animated.timing(scale, {
          toValue: CART_BADGE_FEEDBACK.peakScale,
          duration: CART_BADGE_FEEDBACK.riseDurationMs,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.timing(scale, {
          toValue: 1,
          duration: CART_BADGE_FEEDBACK.settleDurationMs,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
      ]).start();
    }
    prevCount.current = cartCount;
  }, [cartCount, reduceMotion, scale]);

  return (
    <View style={[styles.wrap, { bottom: Math.max(insets.bottom, 14) }]}>
      {MAIN_TABS.map((tab) => {
        const active = activeKey === tab.key;
        return (
          <PressableScale
            key={tab.key}
            haptic="none"
            accessibilityRole="tab"
            accessibilityLabel={t(tab.tKey)}
            accessibilityState={{ selected: active }}
            onPress={() => {
              if (!active) selection();
              router.replace(tab.path as never);
            }}
            style={active ? styles.tabOn : styles.tab}>
            <View>
              <View style={active ? undefined : styles.iconDim}>
                <Icon name={tab.icon} active={active} size={22} color={active ? colors.inkDeep : colors.onAccent} />
              </View>
              {tab.key === 'cart' && cartCount > 0 && (
                <Animated.View style={[styles.badge, { transform: [{ scale }] }]}>
                  <Text style={styles.badgeText}>{formatLocalizedNumber(cartCount, locale)}</Text>
                </Animated.View>
              )}
              {tab.key === 'orders' && unread.orders > 0 && (
                <View
                  style={styles.badge}
                  accessibilityLabel={t('tabBar.unreadOrders', { count: unread.orders })}>
                  <Text style={styles.badgeText}>{formatLocalizedNumber(unread.orders, locale)}</Text>
                </View>
              )}
              {tab.key === 'profile' && unread.support > 0 && (
                <View
                  style={styles.badge}
                  accessibilityLabel={t('tabBar.unreadSupport', { count: unread.support })}>
                  <Text style={styles.badgeText}>{formatLocalizedNumber(unread.support, locale)}</Text>
                </View>
              )}
            </View>
          </PressableScale>
        );
      })}
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
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
  // Same flex:1 as inactive tabs — equal widths are the point of icon-only.
  tabOn: {
    flex: 1,
    height: 52,
    borderRadius: radius.pill,
    backgroundColor: colors.white,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconDim: { opacity: 0.45 },
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
  badgeText: { color: colors.onAccent, fontSize: font.sizes.xs, fontWeight: font.weights.bold },
}));
