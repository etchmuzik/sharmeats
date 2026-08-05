import { useEffect } from 'react';
import { Text, View, Pressable, AccessibilityInfo } from 'react-native';
import Animated, { Easing, useSharedValue, useAnimatedStyle, withTiming } from 'react-native-reanimated';
import { Icon } from './Icon';
import { font, radius, spacing, shadow } from '../theme';
import { makeStyles } from '../themeProvider';
import { useT } from '../i18n';
import type { PaymentMethodKind } from '../data/types';

export const ORDER_CONFIRMATION_ENTER_DURATION_MS = 200;

export function shouldAnimateOrderConfirmation(reduceMotion: boolean): boolean {
  return !reduceMotion;
}

export function shouldCelebrate(param: string | string[] | undefined): boolean {
  const v = Array.isArray(param) ? param[0] : param;
  return v === '1';
}

export function orderConfirmationMessageKey(
  paymentMethodKind: PaymentMethodKind | undefined,
  hasEta: boolean,
): 'celebration.cod' | 'celebration.codEta' | 'celebration.confirmed' | 'celebration.confirmedEta' {
  if (paymentMethodKind === 'cash') {
    return hasEta ? 'celebration.codEta' : 'celebration.cod';
  }
  return hasEta ? 'celebration.confirmedEta' : 'celebration.confirmed';
}

export function OrderCelebration({ visible, etaText, paymentMethodKind, onDone }: {
  visible: boolean; etaText?: string; paymentMethodKind?: PaymentMethodKind; onDone: () => void;
}) {
  const styles = useStyles();
  const t = useT();
  const enter = useSharedValue(0);

  useEffect(() => {
    if (!visible) {
      enter.value = 0;
      return;
    }

    let active = true;
    enter.value = 0;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((reduce) => {
        if (!active) return;
        enter.value = shouldAnimateOrderConfirmation(reduce)
          ? withTiming(1, {
            duration: ORDER_CONFIRMATION_ENTER_DURATION_MS,
            easing: Easing.out(Easing.cubic),
          })
          : 1;
      })
      .catch(() => {
        if (!active) return;
        enter.value = withTiming(1, {
          duration: ORDER_CONFIRMATION_ENTER_DURATION_MS,
          easing: Easing.out(Easing.cubic),
        });
      });
    const timer = setTimeout(onDone, 1600);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [visible, enter, onDone]);

  const cardStyle = useAnimatedStyle(() => ({
    opacity: enter.value,
    transform: [{ translateY: (1 - enter.value) * 16 }],
  }));

  const messageKey = orderConfirmationMessageKey(paymentMethodKind, !!etaText);
  const message = etaText ? t(messageKey, { eta: etaText }) : t(messageKey);

  if (!visible) return null;
  return (
    <Pressable
      style={styles.scrim}
      onPress={onDone}
      accessibilityRole="button"
      accessibilityLabel={t('order.statusPlaced')}
      accessibilityHint={message}>
      <Animated.View style={[styles.card, cardStyle]}>
        <View style={styles.statusMark}>
          <Icon name="check" size={24} color={styles.statusIcon.color} />
        </View>
        <Text style={styles.title}>{t('order.statusPlaced')}</Text>
        <Text style={styles.sub}>
          {message}
        </Text>
      </Animated.View>
    </Pressable>
  );
}

const useStyles = makeStyles((colors) => ({
  scrim: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(19,19,19,0.55)', alignItems: 'center', justifyContent: 'center', zIndex: 100 },
  card: { alignItems: 'center', backgroundColor: colors.surface, borderRadius: radius.xxxl, paddingVertical: spacing.xxxl, paddingHorizontal: spacing.xxl, gap: spacing.sm, ...shadow.card },
  statusMark: { width: 48, height: 48, borderRadius: radius.pill, backgroundColor: colors.greenSoft, alignItems: 'center', justifyContent: 'center' },
  statusIcon: { color: colors.green },
  title: { fontSize: font.sizes['7xl'], fontWeight: font.weights.black, color: colors.ink, marginTop: spacing.xs },
  sub: { fontSize: font.sizes.xl, color: colors.ink2, textAlign: 'center', maxWidth: 240, lineHeight: 20 },
}));
