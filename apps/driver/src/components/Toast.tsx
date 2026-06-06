import { createContext, useCallback, useContext, useRef, useState } from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, font, radius, spacing } from '../theme';

/**
 * Non-blocking toast for the driver app. A courier on the move can't dismiss a
 * blocking alert one-handed for routine feedback (job accepted, update failed),
 * so transient state surfaces as a toast that slides in from the top and
 * auto-dismisses. Money-handling confirmations stay as deliberate Alert dialogs.
 *
 * Animates translateY + opacity only (useNativeDriver), ease-out, no layout
 * props.
 */
type ToastKind = 'error' | 'success' | 'info';

const ToastContext = createContext<{ toast: (msg: string, kind?: ToastKind) => void } | null>(null);

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within <ToastProvider>');
  return ctx;
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const insets = useSafeAreaInsets();
  const [current, setCurrent] = useState<{ msg: string; kind: ToastKind } | null>(null);
  const anim = useRef(new Animated.Value(0)).current;
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const toast = useCallback(
    (msg: string, kind: ToastKind = 'info') => {
      if (hideTimer.current) clearTimeout(hideTimer.current);
      setCurrent({ msg, kind });
      Animated.timing(anim, {
        toValue: 1,
        duration: 220,
        easing: easeOutQuart,
        useNativeDriver: true,
      }).start();
      hideTimer.current = setTimeout(() => {
        Animated.timing(anim, {
          toValue: 0,
          duration: 200,
          easing: easeOutQuart,
          useNativeDriver: true,
        }).start(() => setCurrent(null));
      }, 4000);
    },
    [anim],
  );

  const bg =
    current?.kind === 'error'
      ? colors.redSoft
      : current?.kind === 'success'
        ? colors.greenSoft
        : colors.white;
  const fg =
    current?.kind === 'error' ? colors.red : current?.kind === 'success' ? colors.green : colors.ink;

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      {current && (
        <Animated.View
          pointerEvents="none"
          style={[
            styles.wrap,
            { top: insets.top + spacing.sm, borderColor: fg, backgroundColor: bg },
            {
              opacity: anim,
              transform: [
                { translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [-16, 0] }) },
              ],
            },
          ]}
        >
          <Text style={[styles.text, { color: fg }]} accessibilityLiveRegion="polite">
            {current.msg}
          </Text>
        </Animated.View>
      )}
    </ToastContext.Provider>
  );
}

// ease-out-quart
function easeOutQuart(t: number): number {
  return 1 - Math.pow(1 - t, 4);
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: spacing.lg,
    right: spacing.lg,
    borderWidth: 1,
    borderRadius: radius.lg,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  text: { fontSize: font.sizes.base, fontWeight: font.weights.semibold, textAlign: 'center' },
});
