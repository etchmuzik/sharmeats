'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';
import type { OpsDriver, OpsOrder } from '@/lib/types';
import { Icon } from './Icon';
import { useToast } from './Toast';

/**
 * Fixed reasons for an admin cancellation. These land in `cancel_reason` on the
 * order (via advance_order_status' p_note) so ops has a consistent audit trail
 * instead of the free-text-in-the-SQL-editor path founders used before.
 */
const CANCEL_REASONS = [
  'Restaurant closed',
  'Out of stock',
  'Customer request',
  'No driver available',
  'Duplicate order',
  'Other',
] as const;
type CancelReason = (typeof CANCEL_REASONS)[number];

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
  // Order pending cancellation confirmation (id), and whether the RPC is in flight.
  const [cancelling, setCancelling] = useState<OpsOrder | null>(null);
  const [cancelBusy, setCancelBusy] = useState(false);
  // Shared clock for the elapsed-since-placed chips on the needs-a-driver list —
  // one 60s interval for the whole board, not one per card.
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNowMs(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);

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

  const cancelOrder = useCallback(
    async (orderId: string, reason: CancelReason) => {
      setCancelBusy(true);
      // advance_order_status: admin/dispatcher may move any non-terminal order
      // to 'cancelled' (mig 054 matrix). The reason is stored in cancel_reason,
      // and the terminal-status trigger frees any assigned driver server-side.
      const { error } = await supabase.rpc('advance_order_status', {
        p_order_id: orderId,
        p_new_status: 'cancelled',
        p_note: reason,
      });
      setCancelBusy(false);
      if (error) {
        toast(`Cancel failed: ${error.message}`, 'error');
        return;
      }
      toast('Order cancelled', 'success');
      setCancelling(null);
      if (selectedOrder === orderId) setSelectedOrder(null);
      // Optimistic — Realtime will reconcile (terminal orders drop off the board).
      setOrders((prev) => prev.filter((o) => o.id !== orderId));
    },
    [supabase, toast, selectedOrder],
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
                    <div className="flex items-center gap-2">
                      <ElapsedChip placedAt={o.placed_at} nowMs={nowMs} />
                      <span className="rounded-full bg-sand px-2 py-0.5 text-xs font-semibold">
                        {o.status}
                      </span>
                    </div>
                  </div>
                  <div className="mt-1 text-xs text-ink3">
                    {o.zone ?? 'zone ?'} · {o.payment_method === 'cash_on_delivery' ? 'COD' : 'card'}{' '}
                    · {o.total_egp} EGP
                  </div>
                  <div className="mt-3 flex gap-2">
                    <button
                      onClick={() => setSelectedOrder(selectedOrder === o.id ? null : o.id)}
                      className="flex-1 rounded-xl bg-accent py-2 text-sm font-semibold text-white"
                    >
                      {selectedOrder === o.id ? 'Choose a driver →' : 'Assign driver'}
                    </button>
                    <button
                      onClick={() => setCancelling(o)}
                      className="rounded-xl border border-red px-3 py-2 text-sm font-semibold text-red hover:bg-redsoft"
                    >
                      Cancel
                    </button>
                  </div>
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
                    className="flex items-center justify-between gap-2 rounded-xl border border-line bg-white px-4 py-2 text-sm"
                  >
                    <span className="font-semibold">{o.short_code}</span>
                    <span className="text-ink2">{o.restaurant_name}</span>
                    <span className="rounded bg-sand px-2 py-0.5 text-xs">{o.status}</span>
                    <span className="flex items-center gap-1 text-xs text-sea">
                      <Icon name="scooter" size={13} />
                      {driverName(o.assigned_driver_id)}
                    </span>
                    <button
                      onClick={() => setCancelling(o)}
                      className="rounded-lg border border-red px-2 py-1 text-xs font-semibold text-red hover:bg-redsoft"
                    >
                      Cancel
                    </button>
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

      {cancelling && (
        <CancelDialog
          order={cancelling}
          busy={cancelBusy}
          onConfirm={(reason) => cancelOrder(cancelling.id, reason)}
          onClose={() => {
            if (!cancelBusy) setCancelling(null);
          }}
        />
      )}
    </div>
  );
}

/**
 * Confirm dialog for cancelling an order. Requires a fixed reason to be picked
 * before the action is enabled. Replaces the old founder-in-the-SQL-editor path.
 */
function CancelDialog({
  order,
  busy,
  onConfirm,
  onClose,
}: {
  order: OpsOrder;
  busy: boolean;
  onConfirm: (reason: CancelReason) => void;
  onClose: () => void;
}) {
  const [reason, setReason] = useState<CancelReason | ''>('');

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Cancel order ${order.short_code}`}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm rounded-2xl border border-line bg-white p-5 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-base font-bold text-ink">
          Cancel {order.short_code}?
        </h3>
        <p className="mt-1 text-sm text-ink2">
          {order.restaurant_name} · {order.total_egp} EGP. This cannot be undone.
          {order.assigned_driver_id && ' Any assigned driver is freed automatically.'}
        </p>

        <label className="mt-4 block">
          <span className="mb-1 block text-sm font-semibold text-ink2">Reason</span>
          <select
            value={reason}
            onChange={(e) => setReason(e.target.value as CancelReason)}
            disabled={busy}
            className="w-full rounded-lg border border-line bg-white px-3 py-2 text-sm outline-none focus:border-accent"
          >
            <option value="" disabled>
              Select a reason…
            </option>
            {CANCEL_REASONS.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </label>

        <div className="mt-5 flex gap-2">
          <button
            onClick={onClose}
            disabled={busy}
            className="flex-1 rounded-xl border border-line py-2 text-sm font-semibold text-ink2 hover:bg-sand disabled:opacity-50"
          >
            Keep order
          </button>
          <button
            onClick={() => reason && onConfirm(reason)}
            disabled={!reason || busy}
            className="flex-1 rounded-xl bg-red py-2 text-sm font-semibold text-white disabled:opacity-50"
          >
            {busy ? 'Cancelling…' : 'Cancel order'}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Minutes since the order was placed, color-stepped so a stale unassigned
 * order screams: neutral under 5m, amber 5-10m, red past 10m.
 */
function ElapsedChip({ placedAt, nowMs }: { placedAt: string; nowMs: number }) {
  const mins = Math.max(0, Math.floor((nowMs - new Date(placedAt).getTime()) / 60_000));
  const style =
    mins > 10 ? 'bg-redsoft text-red' : mins >= 5 ? 'bg-amber/10 text-amber' : 'bg-sand text-ink2';
  return <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${style}`}>{mins}m</span>;
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
