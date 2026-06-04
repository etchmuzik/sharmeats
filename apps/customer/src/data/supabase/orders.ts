import { getSupabase } from './client';
import { rowToOrder } from './mappers';
import type { Order } from '../types';
import type { CreateOrderInput } from '../repositories/orders';

export const ordersRepoSupabase = {
  async create(input: CreateOrderInput): Promise<Order> {
    const sb = getSupabase();
    const { data: { user } } = await sb.auth.getUser();
    if (!user) throw new Error('Not authenticated');

    const subtotal = input.items.reduce((acc, ci) => {
      const mods = ci.modifierChoices.reduce((m, c) => m + c.priceDeltaEgp, 0);
      return acc + (ci.basePriceEgp + mods) * ci.quantity;
    }, 0);
    const tax = Math.round(subtotal * (input.taxRate ?? 0.14));
    const tip = input.tipEgp ?? 0;
    const total = subtotal + input.deliveryFeeEgp + tax + tip;
    const slaMinutes = 30;
    const now = new Date();
    const etaAt = new Date(now.getTime() + slaMinutes * 60_000);

    const { data, error } = await sb
      .from('orders')
      .insert({
        user_id: user.id,
        restaurant_id: input.restaurantId,
        restaurant_name: input.restaurantName,
        address_id: input.address.id,
        address_snapshot: input.address,
        items: input.items,
        subtotal_egp: subtotal,
        delivery_fee_egp: input.deliveryFeeEgp,
        tax_egp: tax,
        tip_egp: tip,
        total_egp: total,
        payment_method_kind: input.payment.kind,
        payment_label: input.payment.label,
        status: 'placed',
        history: [{ status: 'placed', at: now.getTime() }],
        placed_at: now.toISOString(),
        eta_at: etaAt.toISOString(),
        sla_minutes: slaMinutes,
        kitchen_notes: input.kitchenNotes ?? null,
        aggregate_allergens: input.aggregateAllergens ?? null,
        scheduled_for: input.scheduledFor ? new Date(input.scheduledFor).toISOString() : null,
      })
      .select()
      .single();
    if (error) throw error;
    return rowToOrder(data);
  },

  async get(id: string): Promise<Order | null> {
    const { data, error } = await getSupabase()
      .from('orders')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    if (error) throw error;
    return data ? rowToOrder(data) : null;
  },

  async list(): Promise<Order[]> {
    const { data, error } = await getSupabase()
      .from('orders')
      .select('*')
      .order('placed_at', { ascending: false });
    if (error) throw error;
    return (data ?? []).map(rowToOrder);
  },

  async listActive(): Promise<Order[]> {
    const { data, error } = await getSupabase()
      .from('orders')
      .select('*')
      .not('status', 'in', '(delivered,cancelled)')
      .order('placed_at', { ascending: false });
    if (error) throw error;
    return (data ?? []).map(rowToOrder);
  },

  async listPast(): Promise<Order[]> {
    const { data, error } = await getSupabase()
      .from('orders')
      .select('*')
      .in('status', ['delivered', 'cancelled'])
      .order('placed_at', { ascending: false });
    if (error) throw error;
    return (data ?? []).map(rowToOrder);
  },

  subscribe(orderId: string, cb: (o: Order) => void): () => void {
    const sb = getSupabase();
    const channel = sb
      .channel(`order:${orderId}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'orders', filter: `id=eq.${orderId}` },
        (payload) => {
          cb(rowToOrder(payload.new as Parameters<typeof rowToOrder>[0]));
        },
      )
      .subscribe();
    return () => {
      sb.removeChannel(channel);
    };
  },

  async forceDelivered(orderId: string): Promise<Order | null> {
    const sb = getSupabase();
    const { data: existing } = await sb.from('orders').select('history').eq('id', orderId).single();
    const hist = Array.isArray(existing?.history) ? existing.history : [];
    const { data, error } = await sb
      .from('orders')
      .update({
        status: 'delivered',
        delivered_at: new Date().toISOString(),
        history: [...hist, { status: 'delivered', at: Date.now() }],
      })
      .eq('id', orderId)
      .select()
      .single();
    if (error) throw error;
    return data ? rowToOrder(data) : null;
  },

  async submitReview(
    orderId: string,
    ratingFood: number,
    ratingDelivery: number,
    comment: string,
  ): Promise<Order | null> {
    const { data, error } = await getSupabase()
      .from('orders')
      .update({
        rating_food: ratingFood,
        rating_delivery: ratingDelivery,
        rating_comment: comment,
      })
      .eq('id', orderId)
      .select()
      .single();
    if (error) throw error;
    return data ? rowToOrder(data) : null;
  },
};
