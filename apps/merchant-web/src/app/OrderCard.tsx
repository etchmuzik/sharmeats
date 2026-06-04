'use client';

import type { MerchantOrder } from '@/lib/types';

interface PrimaryAction {
  label: string;
  run: () => void;
}

export function OrderCard({
  order,
  isNew,
  onAccept,
  onReject,
  onPrimary,
}: {
  order: MerchantOrder;
  isNew?: boolean;
  onAccept?: () => void;
  onReject?: () => void;
  onPrimary?: PrimaryAction;
}) {
  const addr = order.address_snapshot;
  const addrLine =
    addr?.kind === 'hotel'
      ? `${addr.hotelName ?? 'Hotel'} · Room ${addr.roomNumber ?? '—'}`
      : addr?.kind === 'street'
        ? `${addr.streetText ?? ''} ${addr.building ?? ''} ${addr.apartment ?? ''}`.trim()
        : addr?.kind === 'beach_pin'
          ? `Beach · ${addr.beachName ?? ''}`
          : (addr?.label ?? 'Address');

  return (
    <div
      className={`rounded-2xl border bg-white p-4 shadow-sm ${
        isNew ? 'pulse-new border-accent' : 'border-line'
      }`}
    >
      <div className="flex items-start justify-between">
        <div>
          <div className="font-bold">{order.short_code}</div>
          <div className="text-xs text-ink3">
            {new Date(order.placed_at).toLocaleTimeString([], {
              hour: '2-digit',
              minute: '2-digit',
            })}
            {order.scheduled_for && (
              <span className="ml-1 text-amber">
                · scheduled {new Date(order.scheduled_for).toLocaleTimeString([], {
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </span>
            )}
          </div>
        </div>
        <div className="text-right">
          <div className="font-extrabold">{order.total_egp} EGP</div>
          <PaymentBadge order={order} />
        </div>
      </div>

      <div className="mt-3 space-y-1">
        {order.items?.map((it, i) => (
          <div key={i} className="text-sm">
            <span className="font-semibold">{it.quantity}×</span> {it.name}
            {it.modifierChoices && it.modifierChoices.length > 0 && (
              <span className="text-ink3">
                {' '}
                ({it.modifierChoices.map((m) => m.optionName).filter(Boolean).join(', ')})
              </span>
            )}
            {it.notes && <div className="pl-5 text-xs italic text-amber">“{it.notes}”</div>}
          </div>
        ))}
      </div>

      {order.kitchen_notes && (
        <div className="mt-2 rounded-lg bg-amber/10 px-3 py-2 text-xs text-amber">
          Kitchen note: {order.kitchen_notes}
        </div>
      )}

      <div className="mt-3 border-t border-line pt-2 text-xs text-ink2">
        📍 {addrLine}
        <span className="ml-2 rounded bg-sand px-1.5 py-0.5 text-[10px] uppercase">
          {order.fulfillment_type === 'self_delivery' ? 'self-delivery' : 'platform fleet'}
        </span>
      </div>

      {(onAccept || onReject || onPrimary) && (
        <div className="mt-3 flex gap-2">
          {onReject && (
            <button
              onClick={onReject}
              className="flex-1 rounded-xl border border-line py-2 text-sm font-semibold text-red"
            >
              Reject
            </button>
          )}
          {onAccept && (
            <button
              onClick={onAccept}
              className="flex-1 rounded-xl bg-green py-2 text-sm font-semibold text-white"
            >
              Accept
            </button>
          )}
          {onPrimary && (
            <button
              onClick={onPrimary.run}
              className="flex-1 rounded-xl bg-accent py-2 text-sm font-semibold text-white"
            >
              {onPrimary.label}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function PaymentBadge({ order }: { order: MerchantOrder }) {
  if (order.payment_method === 'cash_on_delivery') {
    return <span className="text-xs font-semibold text-sea">Cash on delivery</span>;
  }
  return (
    <span
      className={`text-xs font-semibold ${
        order.payment_status === 'paid' ? 'text-green' : 'text-amber'
      }`}
    >
      Card · {order.payment_status === 'paid' ? 'paid' : order.payment_status}
    </span>
  );
}
