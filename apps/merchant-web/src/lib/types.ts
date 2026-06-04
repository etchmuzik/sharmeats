/** Order shape the merchant dashboard reads (subset of the orders table). */
export interface MerchantOrder {
  id: string;
  short_code: string;
  restaurant_id: string;
  status: OrderStatus;
  payment_method: 'card' | 'cash_on_delivery';
  payment_status: 'pending' | 'paid' | 'failed' | 'refunded';
  fulfillment_type: 'platform' | 'self_delivery';
  subtotal_egp: number;
  delivery_fee_egp: number;
  total_egp: number;
  address_snapshot: AddressSnapshot;
  items: OrderItemSnapshot[];
  kitchen_notes: string | null;
  scheduled_for: string | null;
  placed_at: string;
  eta_at: string;
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

export interface AddressSnapshot {
  kind: 'hotel' | 'street' | 'beach_pin';
  label?: string;
  hotelName?: string;
  roomNumber?: string;
  handoff?: string;
  streetText?: string;
  building?: string;
  apartment?: string;
  landmark?: string;
  beachName?: string;
}

export interface OrderItemSnapshot {
  name: string;
  quantity: number;
  basePriceEgp: number;
  lineTotalEgp?: number;
  modifierChoices?: { modifierName?: string; optionName?: string; priceDeltaEgp?: number }[];
  notes?: string;
}

export interface MerchantContext {
  restaurantId: string;
  restaurantName: string;
  isOpen: boolean;
  staffRole: string;
}
