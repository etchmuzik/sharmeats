'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';
import type { MerchantContext, MerchantOrder, OrderStatus } from '@/lib/types';
import { OrderCard } from './OrderCard';
import { Icon } from './Icon';
import { useToast } from './Toast';

/**
 * Live order queue. Server-rendered initial orders are hydrated here, then a
 * Realtime postgres_changes subscription keeps the list current. New incoming
 * orders trigger a sound + visual pulse so a busy kitchen never misses one.
 *
 * All status changes go through the advance_order_status RPC (server-enforced
 * state machine); this component never writes orders.status directly.
 */
export function OrderQueue({
  context,
  initialOrders,
}: {
  context: MerchantContext;
  initialOrders: MerchantOrder[];
}) {
  const supabase = createSupabaseBrowserClient();
  const { toast } = useToast();
  const [orders, setOrders] = useState<MerchantOrder[]>(initialOrders);
  const [newIds, setNewIds] = useState<Set<string>>(new Set());
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const isVisibleToMerchant = useCallback((o: MerchantOrder) => {
    // COD shows immediately; card orders only once paid.
    return o.payment_method === 'cash_on_delivery' || o.payment_status === 'paid';
  }, []);

  const isActive = useCallback(
    (s: OrderStatus) => !['delivered', 'cancelled', 'rejected'].includes(s),
    [],
  );

  useEffect(() => {
    const channel = supabase
      .channel(`merchant:${context.restaurantId}:orders`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'orders',
          filter: `restaurant_id=eq.${context.restaurantId}`,
        },
        (payload) => {
          const row = payload.new as MerchantOrder;
          if (!row?.id) return;

          setOrders((prev) => {
            const exists = prev.some((o) => o.id === row.id);
            const visible = isVisibleToMerchant(row) && isActive(row.status);

            if (!visible) {
              return prev.filter((o) => o.id !== row.id);
            }
            if (exists) {
              return prev.map((o) => (o.id === row.id ? { ...o, ...row } : o));
            }
            // New visible order — alert.
            playChime();
            setNewIds((s) => new Set(s).add(row.id));
            setTimeout(() => {
              setNewIds((s) => {
                const next = new Set(s);
                next.delete(row.id);
                return next;
              });
            }, 8000);
            return [...prev, row].sort((a, b) => a.placed_at.localeCompare(b.placed_at));
          });
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [context.restaurantId, supabase, isVisibleToMerchant, isActive]);

  function playChime() {
    try {
      audioRef.current?.play().catch(() => {});
    } catch {
      /* autoplay may be blocked until first interaction */
    }
  }

  const advance = useCallback(
    async (orderId: string, next: OrderStatus, note?: string) => {
      const { error } = await supabase.rpc('advance_order_status', {
        p_order_id: orderId,
        p_new_status: next,
        p_note: note ?? null,
      });
      if (error) {
        toast(`Could not update order: ${error.message}`, 'error');
      }
      // Optimistic: the Realtime event will also arrive and reconcile.
      setOrders((prev) =>
        prev
          .map((o) => (o.id === orderId ? { ...o, status: next } : o))
          .filter((o) => isActive(o.status)),
      );
    },
    [supabase, isActive, toast],
  );

  const incoming = orders.filter((o) => o.status === 'placed');
  const inKitchen = orders.filter((o) => ['accepted', 'preparing'].includes(o.status));
  const ready = orders.filter((o) => ['ready', 'picked_up', 'out_for_delivery'].includes(o.status));

  return (
    <div className="mx-auto max-w-6xl px-4 py-6">
      {/* A short data-URI chime so there's no asset dependency. */}
      <audio
        ref={audioRef}
        preload="auto"
        src="data:audio/wav;base64,UklGRl9vT19XQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA="
      />

      {orders.length === 0 ? (
        <div className="mt-24 flex flex-col items-center text-center text-ink3">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-sand text-ink2">
            <Icon name="utensils" size={28} />
          </div>
          <p className="mt-4 text-lg">Waiting for orders…</p>
          <p className="text-sm">New orders appear here instantly with a sound alert.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
          <Column title="New" count={incoming.length} accent>
            {incoming.map((o) => (
              <OrderCard
                key={o.id}
                order={o}
                isNew={newIds.has(o.id)}
                onAccept={() => advance(o.id, 'accepted')}
                onReject={(reason) => advance(o.id, 'rejected', reason)}
              />
            ))}
          </Column>

          <Column title="In kitchen" count={inKitchen.length}>
            {inKitchen.map((o) => (
              <OrderCard
                key={o.id}
                order={o}
                onPrimary={
                  o.status === 'accepted'
                    ? { label: 'Start preparing', run: () => advance(o.id, 'preparing') }
                    : { label: 'Mark ready', run: () => advance(o.id, 'ready') }
                }
              />
            ))}
          </Column>

          <Column title="Ready / out" count={ready.length}>
            {ready.map((o) => (
              <OrderCard
                key={o.id}
                order={o}
                onPrimary={
                  o.fulfillment_type === 'self_delivery' && o.status === 'ready'
                    ? { label: 'Out for delivery', run: () => advance(o.id, 'out_for_delivery') }
                    : o.fulfillment_type === 'self_delivery' && o.status === 'out_for_delivery'
                      ? { label: 'Mark delivered', run: () => advance(o.id, 'delivered') }
                      : undefined
                }
              />
            ))}
          </Column>
        </div>
      )}
    </div>
  );
}

function Column({
  title,
  count,
  accent,
  children,
}: {
  title: string;
  count: number;
  accent?: boolean;
  children: React.ReactNode;
}) {
  return (
    <section>
      <div className="mb-3 flex items-center gap-2">
        <h2 className="text-sm font-bold uppercase tracking-wide text-ink2">{title}</h2>
        <span
          className={`rounded-full px-2 py-0.5 text-xs font-bold ${
            accent ? 'bg-accent text-white' : 'bg-sand text-ink2'
          }`}
        >
          {count}
        </span>
      </div>
      <div className="space-y-3">{children}</div>
    </section>
  );
}
