'use client';

import { useEffect, useState } from 'react';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';

interface Statement {
  id: string;
  period_start: string;
  period_end: string;
  order_count: number;
  gross_sales_egp: number;
  commission_egp: number;
  net_payable_egp: number;
  status: 'draft' | 'finalized' | 'paid';
  paid_reference: string | null;
}

type Phase = { state: 'loading' } | { state: 'ready'; statements: Statement[] } | { state: 'error' };

const money = (egp: number) => `${egp.toLocaleString('en-US')} EGP`;

const STATUS_STYLE: Record<Statement['status'], string> = {
  paid: 'bg-green-100 text-green-700',
  finalized: 'bg-amber-100 text-amber-700',
  draft: 'bg-gray-100 text-gray-600',
};
const STATUS_LABEL: Record<Statement['status'], string> = {
  paid: 'Paid',
  finalized: 'Approved',
  draft: 'Pending',
};

/**
 * Self-fetching payout-statements widget for the merchant dashboard. Mirrors
 * TierStatusCard: no props, fetches via my_restaurant_settlements() (mig 074),
 * which resolves the caller's restaurant server-side. Shows the merchant what
 * they are owed each week (net payable = card food sales minus commission).
 */
export function StatementsCard() {
  const [phase, setPhase] = useState<Phase>({ state: 'loading' });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const supabase = createSupabaseBrowserClient();
      const { data, error } = await supabase.rpc('my_restaurant_settlements', { p_limit: 8 });
      if (cancelled) return;
      if (error) {
        setPhase({ state: 'error' });
        return;
      }
      setPhase({ state: 'ready', statements: (data as Statement[]) ?? [] });
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (phase.state === 'loading') {
    return <div className="h-24 animate-pulse rounded-2xl border border-line bg-white" />;
  }
  if (phase.state === 'error') {
    return null; // fail quiet — the dashboard's core is the order queue
  }

  const { statements } = phase;

  return (
    <div className="rounded-2xl border border-line bg-white p-5">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-bold text-ink2">Weekly payouts</h2>
        <span className="text-xs text-ink3">Net of commission</span>
      </div>
      {statements.length === 0 ? (
        <p className="text-sm text-ink3">
          No statements yet. Your first weekly payout appears here after your orders are delivered.
        </p>
      ) : (
        <div className="space-y-2">
          {statements.map((s) => (
            <div key={s.id} className="flex items-center justify-between rounded-lg border border-line px-3 py-2.5">
              <div>
                <div className="text-sm font-semibold">
                  {s.period_start} → {s.period_end}
                </div>
                <div className="text-xs text-ink3">
                  {s.order_count} orders · {money(s.gross_sales_egp)} sales · {money(s.commission_egp)} commission
                </div>
              </div>
              <div className="flex items-center gap-3">
                <div className="text-right">
                  <div className="text-base font-extrabold">{money(s.net_payable_egp)}</div>
                  {s.paid_reference && <div className="text-xs text-ink3">{s.paid_reference}</div>}
                </div>
                <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${STATUS_STYLE[s.status]}`}>
                  {STATUS_LABEL[s.status]}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
