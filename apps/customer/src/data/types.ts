export type Cuisine =
  | 'italian'
  | 'seafood'
  | 'egyptian'
  | 'sushi'
  | 'healthy'
  | 'burgers'
  | 'cafe'
  | 'asian'
  | 'pizza'
  | 'breakfast'
  | 'late_night'
  | 'street_food'
  | 'sweets'
  | 'grocery'
  | 'pharmacy';

export type ItemFlag =
  | 'halal'
  | 'vegetarian'
  | 'vegan'
  | 'contains_pork'
  | 'contains_alcohol'
  | 'contains_nuts'
  | 'spicy'
  | 'glutenfree';

export type AllergyKey =
  | 'nuts'
  | 'gluten'
  | 'dairy'
  | 'shellfish'
  | 'eggs'
  | 'soy'
  | 'spicy'
  | 'sesame';

export const ALLERGY_KEYS: readonly AllergyKey[] = [
  'nuts',
  'gluten',
  'dairy',
  'shellfish',
  'eggs',
  'soy',
  'spicy',
  'sesame',
] as const;

/**
 * Maps user-facing allergies to item flags so we can render conflict warnings
 * when an item carries a flag the user has opted to avoid. Only the subset of
 * allergens that have a corresponding ItemFlag participates in conflict checks.
 * Note: pork and alcohol are halal/dietary signals — surfaced via FlagBadge on
 * items, not user-toggleable here.
 */
export const ALLERGY_TO_FLAG: Partial<Record<AllergyKey, ItemFlag>> = {
  nuts: 'contains_nuts',
  spicy: 'spicy',
};

export type Zone =
  | 'naama'
  | 'hadaba'
  | 'nabq'
  | 'old_market'
  | 'soho'
  | 'sharks_bay'
  | 'el_salam'
  | 'mubarak_7'
  | 'el_rowaisat'
  | 'hay_el_nour'
  | 'el_hadaba_residential';

export interface Hotel {
  id: string;
  name: string;
  brand: string | null;
  zone: Zone;
  receptionPhone: string;
  verified: boolean;
}

export interface Restaurant {
  id: string;
  slug: string;
  name: string;
  cuisines: Cuisine[];
  cuisineLabel: string;
  coverImage: string;
  logo?: string;
  zone: Zone;
  rating: number;
  ratingCount: number;
  prepTimeLow: number;
  prepTimeHigh: number;
  deliveryFeeEgp: number;
  minOrderEgp: number;
  distanceMeters: number;
  touristSafe: boolean;
  isOpen: boolean;
  isOpen24h?: boolean;
  promo?: string;
  featured?: boolean;
  description: string;
  /** Public contact/location metadata (present for real directory-sourced venues). */
  phone?: string;
  address?: string;
  website?: string;
  /**
   * Company-owned virtual brand (cloud kitchen). Drives the mandatory
   * "Sharm Eats Kitchen" disclosure chip — customers must always be able to
   * tell an own brand from an independent partner (mig 126; CPL 181/2018
   * honesty standard). Undefined until the backend column exists.
   */
  isOwnBrand?: boolean;
}

export interface ModifierOption {
  id: string;
  name: string;
  priceDeltaEgp: number;
  isDefault?: boolean;
  /** Optional emoji/icon for visual add-on cards (e.g. '🧀', '🥓'). */
  icon?: string;
  /** Optional thumbnail image URL for premium add-on cards. */
  image?: string;
  /** Short tagline shown under the option name (e.g. "double portion"). */
  subtitle?: string;
  /** Mark a popular/recommended option to highlight it. */
  popular?: boolean;
  /** Item flags this option adds (e.g. adding bacon → contains_pork). */
  addsFlags?: ItemFlag[];
}

/**
 * How a modifier group is presented. The data is the same set/min/max system;
 * `style` just picks the right UI:
 *  - 'list'        classic radio/checkbox rows (default)
 *  - 'ingredients' tap-to-remove chips for included ingredients (no-onions etc.)
 *  - 'addons'      visual add-on cards with icon/price (extra cheese, sauces)
 *  - 'builder'     a labeled step in a build-your-own flow (bread→protein→…)
 *  - 'size'        segmented size selector (Regular / Large / XL)
 */
export type ModifierStyle = 'list' | 'ingredients' | 'addons' | 'builder' | 'size';

export interface Modifier {
  id: string;
  name: string;
  required: boolean;
  minSelect: number;
  maxSelect: number;
  options: ModifierOption[];
  /** Presentation hint (defaults to 'list'). */
  style?: ModifierStyle;
  /** Optional helper line under the group title. */
  subtitle?: string;
  /** For 'builder' steps: the step order within the build flow. */
  step?: number;
}

export interface MenuSection {
  id: string;
  name: string;
}

export interface MenuItem {
  id: string;
  restaurantId: string;
  sectionId: string;
  name: string;
  description: string;
  priceEgp: number;
  image: string;
  flags: ItemFlag[];
  isAvailable: boolean;
  modifiers: Modifier[];
}

export type AddressKind = 'hotel' | 'street' | 'beach_pin';

export type DropoffPreference =
  | 'hand_to_me'
  | 'leave_at_door'
  | 'meet_outside'
  | 'no_bell'
  | 'call_on_arrival';

export interface Address {
  id: string;
  kind: AddressKind;
  label: string;
  hotelId?: string;
  hotelName?: string;
  roomNumber?: string;
  handoff?: 'lobby' | 'reception' | 'poolside';
  streetText?: string;
  building?: string;
  apartment?: string;
  landmark?: string;
  beachName?: string;
  isDefault?: boolean;
  /**
   * GPS pin (WGS84). Captured for EVERY address kind — even hotels get a pin so
   * the driver always has a map point. Maps to the PostGIS `geo` column.
   */
  lat?: number;
  lng?: number;
}

export type PaymentMethodKind =
  | 'cash'
  | 'fawry'
  | 'vodafone_cash'
  | 'instapay'
  | 'card'
  | 'apple_pay';

export interface PaymentMethod {
  id: string;
  kind: PaymentMethodKind;
  label: string;
  subline: string;
  isDefault?: boolean;
}

export interface CartItemModifierChoice {
  modifierId: string;
  modifierName: string;
  optionId: string;
  optionName: string;
  priceDeltaEgp: number;
}

export interface CartItem {
  lineId: string;
  itemId: string;
  restaurantId: string;
  name: string;
  basePriceEgp: number;
  image: string;
  quantity: number;
  modifierChoices: CartItemModifierChoice[];
  notes?: string;
  allergens?: AllergyKey[];
}

/**
 * Server-side cart preparation (mig 145, `prepare_cart`).
 *
 * Used for the three repeat-order entry points — Orders-tab reorder, saved
 * presets and a restored cart — so all three see the SAME live prices,
 * availability and store state that `place_order` will apply at checkout.
 *
 * Advisory only. Nothing here is authoritative: `place_order` revalidates
 * everything, and no value from this response is ever sent back to the server
 * as a price.
 */
export type PreparedCartIssueCode =
  | 'ITEM_NOT_FOUND'
  | 'ITEM_UNAVAILABLE'
  | 'MODIFIER_GONE'
  | 'REQUIRED_MODIFIER_MISSING'
  | 'INVALID_QTY';

export interface PreparedCartIssue {
  code: PreparedCartIssueCode;
  /** Position in the submitted cart, so the UI can point at the right line. */
  index: number;
  itemId?: string;
  name?: string;
  /** Names of the required modifier groups with nothing selected. */
  modifiers?: string[];
}

export interface PreparedCartLine {
  index: number;
  itemId: string;
  name: string;
  image: string | null;
  /** Today's price, not the price the past order paid. */
  unitPriceEgp: number;
  quantity: number;
  modifierChoices: CartItemModifierChoice[];
  lineTotalEgp: number;
  notes: string | null;
}

export interface PreparedCart {
  restaurantId: string;
  /** is_active AND is_open — the client cannot determine this from a menu. */
  restaurantOpen: boolean;
  minimumOrderEgp: number;
  lines: PreparedCartLine[];
  issues: PreparedCartIssue[];
  /** Display subtotal at current prices. Excludes delivery, promo and fees. */
  subtotalEgp: number;
}

export type OrderStatus =
  | 'placed'
  | 'accepted'
  | 'preparing'
  | 'ready'
  | 'picked_up'
  | 'out_for_delivery'
  | 'delivered'
  | 'cancelled'
  | 'rejected';

export type PaymentStatus = 'pending' | 'paid' | 'failed' | 'refunded';

export type MessageSenderRole = 'customer' | 'driver' | 'merchant_staff' | 'admin';

export interface OrderMessage {
  id: string;
  orderId: string;
  senderId: string;
  senderRole: MessageSenderRole;
  body: string;
  createdAt: number;
  readAt: number | null;
}

export interface Rider {
  id: string;
  name: string;
  photo: string;
  plate: string;
  vehicle: 'scooter' | 'motorbike' | 'bicycle' | 'car';
  rating: number;
  /** Driver phone for the call/message buttons. Filled by the rider_snapshot
   *  RPC (mig 027); optional because legacy/empty snapshots may omit it. */
  phone?: string;
}

export interface OrderStatusEntry {
  status: OrderStatus;
  at: number;
  note?: string;
}

export interface Order {
  id: string;
  shortCode: string;
  userId: string;
  restaurantId: string;
  restaurantName: string;
  addressId: string;
  addressSnapshot: Address;
  items: CartItem[];
  subtotalEgp: number;
  deliveryFeeEgp: number;
  taxEgp: number;
  /** Platform service fee, round(subtotal * service_fee_pct / 100) (mig 096).
   *  0 for orders placed while the fee is dark (service_fee_pct=0). */
  serviceFeeEgp: number;
  /** Flat small-order fee charged in place of the min-order block when
   *  small_order_fee_mode='fee' (mig 096). 0 in the default 'block' mode. */
  smallOrderFeeEgp: number;
  tipEgp: number;
  /** Promo discount already subtracted from totalEgp (0/absent when no promo). */
  discountEgp?: number;
  /** Normalized promo code that produced discountEgp. */
  promoCode?: string;
  totalEgp: number;
  paymentMethodKind: PaymentMethodKind;
  paymentLabel: string;
  /** Server-side settlement state. Card orders stay 'pending' until the Paymob webhook flips them. */
  paymentStatus?: PaymentStatus;
  status: OrderStatus;
  history: OrderStatusEntry[];
  placedAt: number;
  deliveredAt?: number;
  etaAt: number;
  slaMinutes: number;
  /** Customer contact phone captured at checkout; the driver calls this. */
  customerPhone?: string;
  rider?: Rider;
  ratingFood?: number;
  ratingDelivery?: number;
  ratingComment?: string;
  kitchenNotes?: string;
  aggregateAllergens?: AllergyKey[];
  /** Driver-facing handoff instruction (separate from kitchenNotes, which is prep-facing). */
  dropoffPreference?: DropoffPreference;
  /** Optional free-text elaboration on dropoffPreference (e.g. gate code). */
  dropoffNote?: string;
  scheduledFor?: number;
}

export interface SavedOrder {
  id: string;
  restaurantId: string;
  restaurantName: string;
  name: string;
  items: CartItem[];
  createdAt: string;
}

/**
 * Anonymized public review of a restaurant (sourced from order ratings).
 * The reviewer is a masked display name ("Ahmed K." / "Guest") — never an id.
 */
export interface Review {
  ratingFood: number;
  ratingDelivery: number;
  comment?: string;
  reviewer: string;
  reviewedAt: number;
}

export interface User {
  id: string;
  phone: string;
  displayName: string;
  email?: string;
  defaultAddressId?: string;
  defaultPaymentMethodId?: string;
  preferredCurrency: 'EGP' | 'EUR' | 'USD' | 'GBP' | 'RUB';
  locale: 'en' | 'ar' | 'ru' | 'it' | 'de';
  allergyProfile?: AllergyKey[];
  /** ToS version this user last accepted in-app; null/undefined = never accepted. */
  termsAcceptedVersion?: string;
  createdAt: number;
}

export type RewardsTier = 'bronze' | 'silver' | 'gold';

export interface RewardsStatus {
  tier: RewardsTier;
  pointsBalance: number;
  pointsRolling12mo: number;
}

export interface RewardsHistoryEntry {
  id: string;
  deltaPoints: number;
  reason: 'order_earn' | 'redeem' | 'clawback' | 'tier_bonus';
  refOrderId: string | null;
  createdAt: number;
}

/**
 * Notification consent (mig 138). `marketing` is opt-IN — it is false until the
 * customer turns it on, and the server enforces that in send_push_campaign, not
 * the client. Quiet hours are local-clock hours (0-23) in `timezone` and
 * suppress marketing only; order updates are never delayed.
 */
export interface NotificationPrefs {
  transactional: boolean;
  marketing: boolean;
  quietHoursStart: number | null;
  quietHoursEnd: number | null;
  timezone: string;
}

/**
 * A saved dish (mig 139). Deliberately carries the item's CURRENT availability
 * and its restaurant's open/active state rather than filtering them out: a save
 * that silently disappears reads as a bug, and "it's back" is the main reason
 * to keep a list like this.
 */
export interface SavedItem {
  menuItemId: string;
  restaurantId: string;
  name: string;
  description: string;
  priceEgp: number;
  image: string;
  isAvailable: boolean;
  restaurantName: string;
  restaurantIsOpen: boolean;
  restaurantIsActive: boolean;
  savedAt: number;
}

/** Omitted fields are left unchanged, so one toggle never clobbers another. */
export interface NotificationPrefsPatch {
  transactional?: boolean;
  marketing?: boolean;
  quietHoursStart?: number;
  quietHoursEnd?: number;
  timezone?: string;
  clearQuietHours?: boolean;
}
