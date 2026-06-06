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

export interface Rider {
  id: string;
  name: string;
  photo: string;
  plate: string;
  vehicle: 'scooter' | 'motorbike' | 'bicycle' | 'car';
  rating: number;
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
  tipEgp: number;
  totalEgp: number;
  paymentMethodKind: PaymentMethodKind;
  paymentLabel: string;
  status: OrderStatus;
  history: OrderStatusEntry[];
  placedAt: number;
  deliveredAt?: number;
  etaAt: number;
  slaMinutes: number;
  rider?: Rider;
  ratingFood?: number;
  ratingDelivery?: number;
  ratingComment?: string;
  kitchenNotes?: string;
  aggregateAllergens?: AllergyKey[];
  scheduledFor?: number;
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
  createdAt: number;
}
