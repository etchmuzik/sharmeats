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

/** An order on the ops board. */
export interface OpsOrder {
  id: string;
  short_code: string;
  restaurant_id: string;
  restaurant_name: string;
  status: OrderStatus;
  payment_method: 'card' | 'cash_on_delivery';
  payment_status: 'pending' | 'paid' | 'failed' | 'refunded';
  fulfillment_type: 'platform' | 'self_delivery';
  total_egp: number;
  delivery_fee_egp: number;
  assigned_driver_id: string | null;
  zone: string | null;
  address_snapshot: { kind?: string; label?: string; hotelName?: string; roomNumber?: string };
  placed_at: string;
  eta_at: string;
}

export interface OpsDriver {
  id: string;
  name: string;
  phone: string;
  vehicle: 'scooter' | 'motorbike' | 'bicycle' | 'car';
  status: 'offline' | 'online' | 'on_job';
  is_verified: boolean;
  is_active: boolean;
  rating: number;
  home_zone: string | null;
  last_ping_at: string | null;
}

// ============================================================================
// CATALOG — restaurants, menu sections, menu items (admin menu manager)
// Mirrors the public.* schema in supabase/migrations/002_app_schema.sql.
// ============================================================================

export const CUISINES = [
  'italian', 'seafood', 'egyptian', 'sushi', 'healthy', 'burgers', 'cafe',
  'asian', 'pizza', 'breakfast', 'late_night', 'street_food', 'sweets',
  'grocery', 'pharmacy',
] as const;
export type Cuisine = (typeof CUISINES)[number];

export const ZONES = [
  'naama', 'hadaba', 'nabq', 'old_market', 'soho', 'sharks_bay', 'el_salam',
  'mubarak_7', 'el_rowaisat', 'hay_el_nour', 'el_hadaba_residential',
] as const;
export type Zone = (typeof ZONES)[number];

// 'halal' is intentionally omitted from the editor: in Egypt halal is the
// default, so tagging dishes with it is noise. The customer app already hides
// the halal badge (FlagBadge), and the DB enum still allows the value for any
// historical rows — we just don't offer it as a selectable flag here.
export const ITEM_FLAGS = [
  'vegetarian', 'vegan', 'contains_pork', 'contains_alcohol',
  'contains_nuts', 'spicy', 'glutenfree',
] as const;
export type ItemFlag = (typeof ITEM_FLAGS)[number];

/** A restaurant row (catalog). Editable fields the admin manages. */
export interface Restaurant {
  id: string;
  slug: string;
  name: string;
  description: string;
  cuisines: Cuisine[];
  cuisine_label: string;
  cover_image: string;
  logo: string | null;
  zone: Zone;
  rating: number;
  rating_count: number;
  prep_time_low: number;
  prep_time_high: number;
  delivery_fee_egp: number;
  min_order_egp: number;
  tourist_safe: boolean;
  is_open: boolean;
  is_open_24h: boolean | null;
  featured: boolean | null;
  promo: string | null;
  is_active: boolean;
}

export interface MenuSection {
  id: string;
  restaurant_id: string;
  name: string;
  sort_order: number;
}

export interface MenuItem {
  id: string;
  restaurant_id: string;
  section_id: string;
  name: string;
  description: string;
  price_egp: number;
  image: string;
  flags: ItemFlag[];
  is_available: boolean;
  sort_order: number;
}
