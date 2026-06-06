import { Ionicons } from '@expo/vector-icons';
import { colors } from '../theme';

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
  | 'trash'
  | 'warning'
  | 'close'
  | 'star'
  | 'chevronForward'
  | 'chevronBack'
  | 'chevronDown'
  | 'hotel'
  | 'beach'
  | 'compass'
  | 'phone'
  | 'chat'
  | 'check'
  | 'globe'
  | 'currency'
  | 'bell'
  | 'help'
  | 'signout'
  | 'person';

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
  trash: 'trash-outline',
  warning: 'warning-outline',
  close: 'close',
  star: 'star',
  chevronForward: 'chevron-forward',
  chevronBack: 'chevron-back',
  chevronDown: 'chevron-down',
  hotel: 'business-outline',
  beach: 'umbrella-outline',
  compass: 'compass-outline',
  phone: 'call',
  chat: 'chatbubble-ellipses',
  check: 'checkmark',
  globe: 'globe-outline',
  currency: 'cash-outline',
  bell: 'notifications-outline',
  help: 'help-circle-outline',
  signout: 'log-out-outline',
  person: 'person-outline',
};

type Props = {
  name: IconName;
  size?: number;
  color?: string;
  /** Provide only when the icon stands alone (no adjacent text label). */
  accessibilityLabel?: string;
};

export function Icon({ name, size = 18, color = colors.ink, accessibilityLabel }: Props) {
  return (
    <Ionicons
      name={MAP[name]}
      size={size}
      color={color}
      accessibilityElementsHidden={!accessibilityLabel}
      importantForAccessibility={accessibilityLabel ? 'yes' : 'no-hide-descendants'}
      accessibilityLabel={accessibilityLabel}
      accessibilityRole={accessibilityLabel ? 'image' : undefined}
    />
  );
}
