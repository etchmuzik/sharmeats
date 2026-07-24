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
  | 'handoff'
  | 'door'
  | 'walk'
  | 'quiet'
  | 'compass'
  | 'phone'
  | 'chat'
  | 'send'
  | 'check'
  | 'globe'
  | 'currency'
  | 'bell'
  | 'help'
  | 'signout'
  | 'gift' // invite friends / referrals
  | 'share'
  | 'person'
  | 'scooter'
  | 'motorbike'
  | 'bicycle'
  | 'car'
  | 'home'
  | 'doc'; // legal documents (terms / privacy)

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
  handoff: 'hand-left-outline',
  door: 'log-out-outline',
  walk: 'walk-outline',
  quiet: 'notifications-off-outline',
  compass: 'compass-outline',
  phone: 'call',
  chat: 'chatbubble-ellipses',
  send: 'send',
  check: 'checkmark',
  globe: 'globe-outline',
  currency: 'cash-outline',
  bell: 'notifications-outline',
  help: 'help-circle-outline',
  signout: 'log-out-outline',
  gift: 'gift-outline',
  share: 'share-social-outline',
  person: 'person-outline',
  scooter: 'bicycle-outline',
  motorbike: 'bicycle-outline',
  bicycle: 'bicycle-outline',
  car: 'car-outline',
  home: 'home-outline',
  doc: 'document-text-outline',
};

// Filled variants for icons that have an active state (nav tabs mostly).
// Only intents with a meaningful "on" state need an entry; others fall back.
const FILLED_MAP: Partial<Record<IconName, keyof typeof Ionicons.glyphMap>> = {
  cart: 'bag-handle',
  search: 'search',
  receipt: 'receipt',
  gift: 'gift',
  person: 'person',
  location: 'location',
  star: 'star',
  chat: 'chatbubble-ellipses',
  bell: 'notifications',
  home: 'home',
};

export function resolveGlyph(name: IconName, active: boolean): keyof typeof Ionicons.glyphMap {
  if (active && FILLED_MAP[name]) return FILLED_MAP[name] as keyof typeof Ionicons.glyphMap;
  return MAP[name];
}

type Props = {
  name: IconName;
  size?: number;
  color?: string;
  active?: boolean;
  /** Provide only when the icon stands alone (no adjacent text label). */
  accessibilityLabel?: string;
};

export function Icon({ name, size = 18, color = colors.ink, active = false, accessibilityLabel }: Props) {
  return (
    <Ionicons
      name={resolveGlyph(name, active)}
      size={size}
      color={color}
      accessibilityElementsHidden={!accessibilityLabel}
      importantForAccessibility={accessibilityLabel ? 'yes' : 'no-hide-descendants'}
      accessibilityLabel={accessibilityLabel}
      accessibilityRole={accessibilityLabel ? 'image' : undefined}
    />
  );
}
