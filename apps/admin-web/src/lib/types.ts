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
