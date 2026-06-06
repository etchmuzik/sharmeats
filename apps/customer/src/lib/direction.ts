import type { TextStyle, ViewStyle } from 'react-native';
import { useSession } from '../store/session';
import { isRtl } from '../i18n';

/**
 * Runtime RTL helpers for the Arabic locale.
 *
 * We deliberately DON'T use `I18nManager.forceRTL`: it flips the whole native
 * layout but only after an app reload, which breaks the in-app language switcher
 * (the user would pick Arabic and see nothing change until they relaunch).
 * Instead these return per-component style primitives that mirror layout
 * INSTANTLY when the locale changes — apply them to the rows/text that need it.
 *
 *   const dir = useDirection();
 *   <View style={[styles.row, dir.row]}>      // row → row-reverse in AR
 *   <Text style={[styles.label, dir.text]}>   // textAlign + writingDirection
 *   <Icon name={dir.isRtl ? 'chevronBack' : 'chevronForward'} />
 */
export function useDirection() {
  const locale = useSession((s) => s.locale);
  const rtl = isRtl(locale);
  return {
    isRtl: rtl,
    /** Mirror a flex row. Spread onto a row container's style. */
    row: { flexDirection: rtl ? 'row-reverse' : 'row' } as ViewStyle,
    /** Align text to the reading edge + set writing direction for mixed scripts. */
    text: {
      textAlign: rtl ? 'right' : 'left',
      writingDirection: rtl ? 'rtl' : 'ltr',
    } as TextStyle,
    /** Start-edge alignment for an items container (e.g. alignItems). */
    alignStart: (rtl ? 'flex-end' : 'flex-start') as ViewStyle['alignItems'],
  };
}
