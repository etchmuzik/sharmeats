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
    addressSnapshot: o.address_snapshot,
    items: o.items,
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
    history: o.history,
    placedAt: new Date(o.placed_at).getTime(),
    deliveredAt: o.delivered_at ? new Date(o.delivered_at).getTime() : undefined,
    etaAt: new Date(o.eta_at).getTime(),
    slaMinutes: o.sla_minutes,
    rider: o.rider ?? undefined,
    ratingFood: o.rating_food ?? undefined,
    ratingDelivery: o.rating_delivery ?? undefined,
    ratingComment: o.rating_comment ?? undefined,
    kitchenNotes: o.kitchen_notes ?? undefined,
    aggregateAllergens: (o.aggregate_allergens ?? undefined) as Order['aggregateAllergens'],
    scheduledFor: o.scheduled_for ? new Date(o.scheduled_for).getTime() : undefined,
  };
}
