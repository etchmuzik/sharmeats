'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';
import type { OpsDriver, OpsOrder } from '@/lib/types';
import { Icon } from './Icon';
import { useToast } from './Toast';

/**
 * Manual dispatch board (+ live ops).
 *
 * Left: orders that need a platform driver (fulfillment_type='platform',
 * not yet assigned, in preparing/ready/accepted). Right: online drivers.
 * Click an order then a driver to assign_driver. Realtime keeps both live.
 *
 * Self-delivery orders never appear here — they're the merchant's to deliver.
 * When dispatch_mode flips to 'auto', this becomes a monitoring view.
 */
export function DispatchBoard({
  initialOrders,
  initialDrivers,
}: {
  initialOrders: OpsOrder[];
  initialDrivers: OpsDriver[];
}) {
  const supabase = createSupabaseBrowserClient();
  const { toast } = useToast();
  const [orders, setOrders] = useState<OpsOrder[]>(initialOrders);
  const [drivers, setDrivers] = useState<OpsDriver[]>(initialDrivers);
  const [selectedOrder, setSelectedOrder] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Realtime: orders + driver status.
  useEffect(() => {
    const ch = supabase
      .channel('ops:board')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, (p) => {
        const row = p.new as OpsOrder;
        if (!row?.id) return;
        const terminal = ['delivered', 'cancelled', 'rejected'].includes(row.status);
        setOrders((prev) => {
          const rest = prev.filter((o) => o.id !== row.id);
          return terminal ? rest : [...rest, row].sort((a, b) => a.placed_at.localeCompare(b.placed_at));
        });
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'drivers' }, (p) => {
        const row = p.new as OpsDriver;
        if (!row?.id) return;
        setDrivers((prev) => {
          const rest = prev.filter((d) => d.id !== row.id);
          return row.is_active ? [...rest, row] : rest;
        });
      })
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [supabase]);

  const needsDispatch = useMemo(
    () =>
      orders.filter(
        (o) =>
          o.fulfillment_type === 'platform' &&
          !o.assigned_driver_id &&
          ['accepted', 'preparing', 'ready'].includes(o.status),
      ),
    [orders],
  );
  const assigned = useMemo(
    () => orders.filter((o) => o.assigned_driver_id),
    [orders],
  );
  const onlineDrivers = useMemo(
    () => drivers.filter((d) => d.status === 'online' && d.is_verified),
    [drivers],
  );

  const assign = useCallback(
    async (orderId: string, driverId: string) => {
      setBusy(true);
      const { error } = await supabase.rpc('assign_driver', {
        p_order_id: orderId,
        p_driver_id: driverId,
      });
      setBusy(false);
      if (error) {
        toast(`Assign failed: ${error.message}`, 'error');
        return;
      }
      toast('Driver assigned', 'success');
      setSelectedOrder(null);
      // Optimistic — Realtime will reconcile.
      setOrders((prev) =>
        prev.map((o) => (o.id === orderId ? { ...o, assigned_driver_id: driverId } : o)),
      );
    },
    [supabase, toast],
  );

  const driverName = (id: string | null) => drivers.find((d) => d.id === id)?.name ?? '—';

  return (
    <div className="mx-auto max-w-7xl px-4 py-6">
      {/* Stat strip */}
      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Needs dispatch" value={needsDispatch.length} accent />
        <Stat label="Assigned / en route" value={assigned.length} />
        <Stat label="Drivers online" value={onlineDrivers.length} />
        <Stat label="Active orders" value={orders.length} />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Needs dispatch */}
        <section className="lg:col-span-2">
          <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-ink2">
            Needs a driver
          </h2>
          {needsDispatch.length === 0 ? (
            <EmptyHint>All caught up — no platform orders waiting for a driver.</EmptyHint>
          ) : (
            <div className="space-y-3">
              {needsDispatch.map((o) => (
                <div
                  key={o.id}
                  className={`rounded-2xl border bg-white p-4 ${
                    selectedOrder === o.id ? 'border-accent ring-2 ring-accent/30' : 'border-line'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <span className="font-bold">{o.short_code}</span>
                      <span className="ml-2 text-sm text-ink2">{o.restaurant_name}</span>
                    </div>
                    <span className="rounded-full bg-sand px-2 py-0.5 text-xs font-semibold">
                      {o.status}
                    </span>
                  </div>
                  <div className="mt-1 text-xs text-ink3">
                    {o.zone ?? 'zone ?'} · {o.payment_method === 'cash_on_delivery' ? 'COD' : 'card'}{' '}
                    · {o.total_egp} EGP
                  </div>
                  <button
                    onClick={() => setSelectedOrder(selectedOrder === o.id ? null : o.id)}
                    className="mt-3 w-full rounded-xl bg-accent py-2 text-sm font-semibold text-white"
                  >
                    {selectedOrder === o.id ? 'Choose a driver →' : 'Assign driver'}
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Assigned list */}
          {assigned.length > 0 && (
            <>
              <h2 className="mb-3 mt-8 text-sm font-bold uppercase tracking-wide text-ink2">
                In progress
              </h2>
              <div className="space-y-2">
                {assigned.map((o) => (
                  <div
                    key={o.id}
                    className="flex items-center justify-between rounded-xl border border-line bg-white px-4 py-2 text-sm"
                  >
                    <span className="font-semibold">{o.short_code}</span>
                    <span className="text-ink2">{o.restaurant_name}</span>
                    <span className="rounded bg-sand px-2 py-0.5 text-xs">{o.status}</span>
                    <span className="flex items-center gap-1 text-xs text-sea">
                      <Icon name="scooter" size={13} />
                      {driverName(o.assigned_driver_id)}
                    </span>
                  </div>
                ))}
              </div>
            </>
          )}
        </section>

        {/* Drivers panel */}
        <section>
          <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-ink2">
            Drivers {selectedOrder && <span className="text-accent">· pick one to assign</span>}
          </h2>
          <div className="space-y-2">
            {drivers
              .slice()
              .sort((a, b) => a.status.localeCompare(b.status))
              .map((d) => {
                const assignable = selectedOrder && d.status === 'online' && d.is_verified;
                return (
                  <button
                    key={d.id}
                    disabled={!assignable || busy}
                    onClick={() => selectedOrder && assign(selectedOrder, d.id)}
                    className={`flex w-full items-center justify-between rounded-xl border px-4 py-3 text-left ${
                      assignable
                        ? 'border-accent bg-accentsoft hover:bg-accent hover:text-white'
                        : 'border-line bg-white opacity-90'
                    }`}
                  >
                    <div>
                      <div className="text-sm font-semibold">{d.name}</div>
                      <div className="flex items-center gap-1 text-xs text-ink3">
                        {d.vehicle} ·
                        <Icon name="star" size={11} className="text-star" /> {d.rating} ·{' '}
                        {d.home_zone ?? 'zone ?'}
                      </div>
                    </div>
                    <StatusDot status={d.status} />
                  </button>
                );
              })}
          </div>
        </section>
      </div>
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: number; accent?: boolean }) {
  return (
    <div className={`rounded-2xl border p-4 ${accent ? 'border-accent bg-accentsoft' : 'border-line bg-white'}`}>
      <div className={`text-2xl font-extrabold ${accent ? 'text-accentdark' : 'text-ink'}`}>{value}</div>
      <div className="text-xs text-ink2">{label}</div>
    </div>
  );
}

function StatusDot({ status }: { status: OpsDriver['status'] }) {
  const map = {
    online: 'bg-green',
    on_job: 'bg-amber',
    offline: 'bg-ink3',
  } as const;
  return (
    <span className="flex items-center gap-1 text-xs text-ink2">
      <span className={`h-2 w-2 rounded-full ${map[status]}`} />
      {status}
    </span>
  );
}

function EmptyHint({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-dashed border-line bg-white p-8 text-center text-ink3">
      {children}
    </div>
  );
}
