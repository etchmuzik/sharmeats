import { Ionicons } from '@expo/vector-icons';
import { useThemeColors } from '../themeProvider';

/**
 * Semantic icon wrapper over @expo/vector-icons (Ionicons). Screens reference
 * icons by INTENT, not glyph name, so the icon set can be swapped in one place.
 * Icons paired with a visible label are decorative → hidden from a11y; pass
 * `accessibilityLabel` for an icon that stands alone.
 */
export type IconName =
  | 'location'
  | 'cart'
  | 'card'
  | 'cash'
  | 'receipt'
  | 'calendar'
  | 'warning'
  | 'close'
  | 'chevronForward'
  | 'chevronBack'
  | 'chevronDown'
  | 'hotel'
  | 'beach'
  | 'restaurant'
  | 'check'
  | 'bell'
  | 'signout'
  | 'person'
  | 'clock'
  | 'flame'
  | 'bag'
  | 'phone'
  | 'chat'
  | 'send'
  | 'alert'
  | 'sound'
  | 'mute'
  // Appearance control: the icon reflects which theme mode is active.
  | 'themeAuto'
  | 'themeLight'
  | 'themeDark';

const MAP: Record<IconName, keyof typeof Ionicons.glyphMap> = {
  location: 'location-outline',
  cart: 'bag-handle-outline',
  card: 'card-outline',
  cash: 'cash-outline',
  receipt: 'receipt-outline',
  calendar: 'calendar-outline',
  warning: 'warning-outline',
  close: 'close',
  chevronForward: 'chevron-forward',
  chevronBack: 'chevron-back',
  chevronDown: 'chevron-down',
  hotel: 'business-outline',
  beach: 'umbrella-outline',
  restaurant: 'restaurant-outline',
  check: 'checkmark',
  bell: 'notifications-outline',
  signout: 'log-out-outline',
  person: 'person-outline',
  clock: 'time-outline',
  flame: 'flame-outline',
  bag: 'bag-check-outline',
  phone: 'call',
  chat: 'chatbubble-ellipses',
  send: 'send',
  alert: 'alert-circle',
  sound: 'volume-high-outline',
  mute: 'volume-mute-outline',
  themeAuto: 'contrast-outline',
  themeLight: 'sunny-outline',
  themeDark: 'moon-outline',
};

type Props = {
  name: IconName;
  size?: number;
  color?: string;
  accessibilityLabel?: string;
};

export function Icon({ name, size = 18, color, accessibilityLabel }: Props) {
  // The default ink color must come from the ACTIVE palette; as a default
  // parameter it was evaluated against whatever `colors` was imported at module
  // load, pinning every unstyled icon to the light theme.
  const colors = useThemeColors();
  return (
    <Ionicons
      name={MAP[name]}
      size={size}
      color={color ?? colors.ink}
      accessibilityElementsHidden={!accessibilityLabel}
      importantForAccessibility={accessibilityLabel ? 'yes' : 'no-hide-descendants'}
      accessibilityLabel={accessibilityLabel}
      accessibilityRole={accessibilityLabel ? 'image' : undefined}
    />
  );
}
