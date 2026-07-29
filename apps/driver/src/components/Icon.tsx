import { Ionicons } from '@expo/vector-icons';
import { useThemeColors } from '../themeProvider';

/**
 * Semantic icon wrapper over @expo/vector-icons (Ionicons), replacing the
 * emoji-as-UI that rendered inconsistently across platforms and read poorly to
 * screen readers. Screens reference icons by INTENT (`location`, `cart`), not by
 * glyph name, so the icon set can be swapped in one place.
 *
 * Icons paired with a visible text label are decorative → hidden from the
 * accessibility tree by default (the label carries the meaning). Pass
 * `accessibilityLabel` for an icon that stands alone.
 */
export type IconName =
  | 'location'
  | 'search'
  | 'cart'
  | 'card'
  | 'cash'
  | 'wallet' // vodafone cash / mobile money
  | 'transfer' // instapay
  | 'receipt' // fawry
  | 'bolt' // ASAP
  | 'calendar'
  | 'clock' // offer expiry countdown
  | 'trash'
  | 'warning'
  | 'close'
  | 'star'
  | 'chevronForward'
  | 'chevronBack'
  | 'chevronDown'
  | 'hotel'
  | 'beach'
  | 'handoff'
  | 'door'
  | 'walk'
  | 'quiet'
  | 'compass'
  | 'navigate'
  | 'restaurant'
  | 'phone'
  | 'chat'
  | 'check'
  | 'globe'
  | 'currency'
  | 'bell'
  | 'help'
  | 'signout'
  | 'person'
  | 'trophy'
  // Appearance control: the icon reflects which theme mode is active.
  | 'themeAuto'
  | 'themeLight'
  | 'themeDark';

const MAP: Record<IconName, keyof typeof Ionicons.glyphMap> = {
  location: 'location-outline',
  search: 'search-outline',
  cart: 'bag-handle-outline',
  card: 'card-outline',
  cash: 'cash-outline',
  wallet: 'phone-portrait-outline',
  transfer: 'swap-horizontal-outline',
  receipt: 'receipt-outline',
  bolt: 'flash',
  calendar: 'calendar-outline',
  clock: 'time-outline',
  trash: 'trash-outline',
  warning: 'warning-outline',
  close: 'close',
  star: 'star',
  chevronForward: 'chevron-forward',
  chevronBack: 'chevron-back',
  chevronDown: 'chevron-down',
  hotel: 'business-outline',
  beach: 'umbrella-outline',
  handoff: 'hand-left-outline',
  door: 'log-out-outline',
  walk: 'walk-outline',
  quiet: 'notifications-off-outline',
  compass: 'compass-outline',
  navigate: 'navigate',
  restaurant: 'restaurant-outline',
  phone: 'call',
  chat: 'chatbubble-ellipses',
  check: 'checkmark',
  globe: 'globe-outline',
  currency: 'cash-outline',
  bell: 'notifications-outline',
  help: 'help-circle-outline',
  signout: 'log-out-outline',
  person: 'person-outline',
  trophy: 'trophy-outline',
  themeAuto: 'contrast-outline',
  themeLight: 'sunny-outline',
  themeDark: 'moon-outline',
};

type Props = {
  name: IconName;
  size?: number;
  color?: string;
  /** Provide only when the icon stands alone (no adjacent text label). */
  accessibilityLabel?: string;
};

export function Icon({ name, size = 18, color, accessibilityLabel }: Props) {
  // The default ink color has to be resolved from the ACTIVE palette, so it
  // cannot be a default parameter value the way it was — a default parameter is
  // evaluated against whatever `colors` was imported at module load, which
  // would pin every unstyled icon to the light theme.
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
