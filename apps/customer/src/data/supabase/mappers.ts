import type {
  Address,
  Hotel,
  MenuItem,
  MenuSection,
  Order,
  PaymentMethod,
  Restaurant,
  Rider,
  User,
} from '../types';

/**
 * Parse a Postgres timestamp to epoch ms, safely on Hermes (the on-device JS
 * engine). PostgREST returns ISO-8601 ("...T...+00:00") which Hermes parses, but
 * Realtime postgres_changes delivers the raw WAL form ("2026-06-27 23:36:59+00":
 * space separator, no colon in the offset) which Hermes' Date parser REJECTS
 * (returns NaN) — Node/V8 is lenient and hides this. A NaN etaAt then renders as
 * "NaN min" on the tracking screen the moment a status update arrives. Normalize
 * the space→T and the "+00"→"+00:00" offset so both forms parse to the real instant.
 */
function tsToMs(s: string | number | null | undefined): number | undefined {
  if (s == null) return undefined;
  if (typeof s === 'number') return s;
  const iso = s.replace(' ', 'T').replace(/([+-]\d{2})$/, '$1:00');
  let ms = new Date(iso).getTime();
  if (Number.isNaN(ms)) ms = new Date(s).getTime(); // last resort for already-ISO strings
  return Number.isNaN(ms) ? undefined : ms;
}

/**
 * The order's address_snapshot jsonb is a verbatim copy of the snake_case
 * `addresses` row (place_order does to_jsonb(v_addr)). The UI reads the camelCase
 * Address shape (hotelName, roomNumber, handoff, …), so a raw passthrough makes
 * hotel name/room/handoff render blank on tracking. Normalize keys here. Accepts
 * an already-camelCase object too (idempotent) so it's safe for any caller.
 */
function normalizeAddressSnapshot(raw: unknown): Address | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const a = raw as Record<string, unknown>;
  const pick = (camel: string, snake: string) => a[camel] ?? a[snake];
  return {
    id: (pick('id', 'id') as string) ?? '',
    kind: (pick('kind', 'kind') as Address['kind']) ?? 'street',
    label: (pick('label', 'label') as string) ?? '',
    hotelId: (pick('hotelId', 'hotel_id') as string) ?? undefined,
    hotelName: (pick('hotelName', 'hotel_name') as string) ?? undefined,
    roomNumber: (pick('roomNumber', 'room_number') as string) ?? undefined,
    handoff: (pick('handoff', 'handoff') as Address['handoff']) ?? undefined,
    streetText: (pick('streetText', 'street_text') as string) ?? undefined,
    building: (pick('building', 'building') as string) ?? undefined,
    apartment: (pick('apartment', 'apartment') as string) ?? undefined,
    landmark: (pick('landmark', 'landmark') as string) ?? undefined,
    beachName: (pick('beachName', 'beach_name') as string) ?? undefined,
    isDefault: Boolean(pick('isDefault', 'is_default')),
  };
}

interface RestaurantRow {
  id: string;
  slug: string;
  name: string;
  cuisines: string[];
  cuisine_label: string;
  cover_image: string;
  logo: string | null;
  zone: string;
  rating: number;
  rating_count: number;
  prep_time_low: number;
  prep_time_high: number;
  delivery_fee_egp: number;
  min_order_egp: number;
  distance_meters: number;
  tourist_safe: boolean;
  is_open: boolean;
  is_open_24h: boolean | null;
  promo: string | null;
  featured: boolean | null;
  description: string;
  phone: string | null;
  address: string | null;
  website: string | null;
}

export function rowToRestaurant(r: RestaurantRow): Restaurant {
  return {
    id: r.id,
    slug: r.slug,
    name: r.name,
    cuisines: r.cuisines as Restaurant['cuisines'],
    cuisineLabel: r.cuisine_label,
    coverImage: r.cover_image,
    logo: r.logo ?? undefined,
    zone: r.zone as Restaurant['zone'],
    rating: r.rating,
    ratingCount: r.rating_count,
    prepTimeLow: r.prep_time_low,
    prepTimeHigh: r.prep_time_high,
    deliveryFeeEgp: r.delivery_fee_egp,
    minOrderEgp: r.min_order_egp,
    distanceMeters: r.distance_meters,
    touristSafe: r.tourist_safe,
    isOpen: r.is_open,
    isOpen24h: r.is_open_24h ?? undefined,
    promo: r.promo ?? undefined,
    featured: r.featured ?? undefined,
    description: r.description,
    phone: r.phone ?? undefined,
    address: r.address ?? undefined,
    website: r.website ?? undefined,
  };
}

interface HotelRow {
  id: string;
  name: string;
  brand: string | null;
  zone: string;
  reception_phone: string;
  verified: boolean;
}

export function rowToHotel(h: HotelRow): Hotel {
  return {
    id: h.id,
    name: h.name,
    brand: h.brand,
    zone: h.zone as Hotel['zone'],
    receptionPhone: h.reception_phone,
    verified: h.verified,
  };
}

interface AddressRow {
  id: string;
  kind: 'hotel' | 'street' | 'beach_pin';
  label: string;
  hotel_id: string | null;
  hotel_name: string | null;
  room_number: string | null;
  handoff: 'lobby' | 'reception' | 'poolside' | null;
  street_text: string | null;
  building: string | null;
  apartment: string | null;
  landmark: string | null;
  beach_name: string | null;
  is_default: boolean;
}

export function rowToAddress(a: AddressRow): Address {
  return {
    id: a.id,
    kind: a.kind,
    label: a.label,
    hotelId: a.hotel_id ?? undefined,
    hotelName: a.hotel_name ?? undefined,
    roomNumber: a.room_number ?? undefined,
    handoff: a.handoff ?? undefined,
    streetText: a.street_text ?? undefined,
    building: a.building ?? undefined,
    apartment: a.apartment ?? undefined,
    landmark: a.landmark ?? undefined,
    beachName: a.beach_name ?? undefined,
    isDefault: a.is_default,
  };
}

interface PaymentMethodRow {
  id: string;
  kind: string;
  label: string;
  subline: string;
  is_default: boolean;
}

export function rowToPaymentMethod(p: PaymentMethodRow): PaymentMethod {
  return {
    id: p.id,
    kind: p.kind as PaymentMethod['kind'],
    label: p.label,
    subline: p.subline,
    isDefault: p.is_default,
  };
}

interface UserRow {
  id: string;
  phone: string;
  display_name: string;
  email: string | null;
  default_address_id: string | null;
  default_payment_method_id: string | null;
  preferred_currency: 'EGP' | 'EUR' | 'USD' | 'GBP' | 'RUB';
  locale: 'en' | 'ar' | 'ru' | 'it' | 'de';
  allergy_profile: string[] | null;
  created_at: string;
}

export function rowToUser(u: UserRow): User {
  return {
    id: u.id,
    phone: u.phone,
    displayName: u.display_name,
    email: u.email ?? undefined,
    defaultAddressId: u.default_address_id ?? undefined,
    defaultPaymentMethodId: u.default_payment_method_id ?? undefined,
    preferredCurrency: u.preferred_currency,
    locale: u.locale,
    allergyProfile: (u.allergy_profile ?? []) as User['allergyProfile'],
    createdAt: new Date(u.created_at).getTime(),
  };
}

interface MenuSectionRow {
  id: string;
  name: string;
}

export function rowToMenuSection(s: MenuSectionRow): MenuSection {
  return { id: s.id, name: s.name };
}

interface MenuItemRow {
  id: string;
  restaurant_id: string;
  section_id: string;
  name: string;
  description: string;
  price_egp: number;
  image: string;
  flags: string[];
  is_available: boolean;
}

export function rowToMenuItem(i: MenuItemRow): MenuItem {
  return {
    id: i.id,
    restaurantId: i.restaurant_id,
    sectionId: i.section_id,
    name: i.name,
    description: i.description,
    priceEgp: i.price_egp,
    image: i.image,
    flags: i.flags as MenuItem['flags'],
    isAvailable: i.is_available,
    modifiers: [],
  };
}

interface RiderRow {
  id: string;
  name: string;
  photo: string;
  plate: string;
  vehicle: 'scooter' | 'motorbike' | 'bicycle' | 'car';
  rating: number;
}

export function rowToRider(r: RiderRow): Rider {
  return {
    id: r.id,
    name: r.name,
    photo: r.photo,
    plate: r.plate,
    vehicle: r.vehicle,
    rating: r.rating,
  };
}

interface OrderRow {
  id: string;
  short_code: string;
  user_id: string;
  restaurant_id: string;
  restaurant_name: string;
  address_id: string;
  address_snapshot: Address;
  items: Order['items'];
  subtotal_egp: number;
  delivery_fee_egp: number;
  tax_egp: number;
  tip_egp: number;
  discount_egp?: number | null;
  promo_code?: string | null;
  total_egp: number;
  payment_method_kind: string;
  payment_label: string;
  payment_status: string | null;
  status: Order['status'];
  history: Order['history'];
  placed_at: string;
  delivered_at: string | null;
  eta_at: string;
  sla_minutes: number;
  rider: Rider | null;
  rating_food: number | null;
  rating_delivery: number | null;
  rating_comment: string | null;
  kitchen_notes: string | null;
  dropoff_preference: Order['dropoffPreference'] | null;
  dropoff_note: string | null;
  aggregate_allergens: string[] | null;
  scheduled_for: string | null;
}

export function rowToOrder(o: OrderRow): Order {
  return {
    id: o.id,
    shortCode: o.short_code,
    userId: o.user_id,
    restaurantId: o.restaurant_id,
    restaurantName: o.restaurant_name,
    addressId: o.address_id,
    addressSnapshot: normalizeAddressSnapshot(o.address_snapshot) ?? o.address_snapshot,
    // Server item lines have no lineId (place_order omits it); synthesize a stable
    // one so React keys + any line-keyed UI work. Other fields pass through.
    items: Array.isArray(o.items)
      ? o.items.map((it, i) => ({
          ...it,
          lineId: (it as { lineId?: string }).lineId ?? `${o.id}-${i}`,
        }))
      : // Non-array items → []. A null/undefined items would otherwise pass
        // through and crash any .map() in the order UI (mirrors the history
        // coercion below).
        [],
    subtotalEgp: o.subtotal_egp,
    deliveryFeeEgp: o.delivery_fee_egp,
    taxEgp: o.tax_egp,
    tipEgp: o.tip_egp,
    discountEgp: o.discount_egp ?? undefined,
    promoCode: o.promo_code ?? undefined,
    totalEgp: o.total_egp,
    paymentMethodKind: o.payment_method_kind as Order['paymentMethodKind'],
    paymentLabel: o.payment_label,
    paymentStatus: (o.payment_status ?? undefined) as Order['paymentStatus'],
    status: o.status,
    history: Array.isArray(o.history) ? o.history : [],
    placedAt: tsToMs(o.placed_at) ?? Date.now(),
    deliveredAt: tsToMs(o.delivered_at),
    etaAt: tsToMs(o.eta_at) ?? Date.now(),
    slaMinutes: o.sla_minutes,
    customerPhone: (o as { customer_phone?: string | null }).customer_phone ?? undefined,
    rider: o.rider ?? undefined,
    ratingFood: o.rating_food ?? undefined,
    ratingDelivery: o.rating_delivery ?? undefined,
    ratingComment: o.rating_comment ?? undefined,
    kitchenNotes: o.kitchen_notes ?? undefined,
    dropoffPreference: o.dropoff_preference ?? undefined,
    dropoffNote: o.dropoff_note ?? undefined,
    aggregateAllergens: (o.aggregate_allergens ?? undefined) as Order['aggregateAllergens'],
    scheduledFor: tsToMs(o.scheduled_for),
  };
}
