'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';
import type { RestaurantSettlement } from '@/lib/types';
import { SignOutButton } from '../SignOutButton';
import { useToast } from '../Toast';
import { Skeleton } from '../Skeleton';

type Phase =
  | { state: 'loading' }
  | { state: 'unauthorized' }
  | { state: 'ready'; displayName: string };

interface Row extends RestaurantSettlement {
  restaurant_name: string;
}

// Default the period to the most recent complete Sun–Sat week (the LOI's
// weekly-Sunday payout cadence). Returns ISO yyyy-mm-dd strings.
function lastWeek(): { start: string; end: string } {
  const now = new Date();
  const day = now.getUTCDay(); // 0 = Sunday
  // End of last week = the most recent Saturday before this week's Sunday.
  const thisSunday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - day));
  const lastSunday = new Date(thisSunday);
  lastSunday.setUTCDate(thisSunday.getUTCDate() - 7);
  const lastSaturday = new Date(thisSunday);
  lastSaturday.setUTCDate(thisSunday.getUTCDate() - 1);
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  return { start: iso(lastSunday), end: iso(lastSaturday) };
}

const money = (egp: number) => `${egp.toLocaleString('en-US')} EGP`;

export default function FinancePage() {
  const router = useRouter();
  const { toast } = useToast();
  const [phase, setPhase] = useState<Phase>({ state: 'loading' });
  const [{ start, end }, setPeriod] = useState(lastWeek());
  const [rows, setRows] = useState<Row[]>([]);
  const [busy, setBusy] = useState(false);

  const loadRows = useCallback(async () => {
    const supabase = createSupabaseBrowserClient();
    // Statements for the selected period, joined to restaurant name.
    const { data, error } = await supabase
      .from('restaurant_settlements')
      .select('*, restaurants(name)')
      .eq('period_start', start)
      .eq('period_end', end)
      .order('net_payable_egp', { ascending: false });
    if (error) {
      toast(error.message, 'error');
      return;
    }
    const mapped = (data ?? []).map((r) => {
      const rec = r as RestaurantSettlement & { restaurants: { name: string } | null };
      return { ...rec, restaurant_name: rec.restaurants?.name ?? 'Unknown' };
    });
    setRows(mapped);
  }, [start, end, toast]);

  useEffect(() => {
    const supabase = createSupabaseBrowserClient();
    let cancelled = false;
    (async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) {
        router.replace('/login');
        return;
      }
      const { data: me } = await supabase.from('users').select('role, display_name').eq('id', session.user.id).single();
      if ((me?.role as string | undefined) !== 'admin') {
        if (!cancelled) setPhase({ state: 'unauthorized' });
        return;
      }
      await loadRows();
      if (!cancelled) setPhase({ state: 'ready', displayName: me?.display_name ?? 'Admin' });
    })();
    return () => {
      cancelled = true;
    };
  }, [router, loadRows]);

  const generate = async () => {
    setBusy(true);
    try {
      const supabase = createSupabaseBrowserClient();
      const { data, error } = await supabase.rpc('generate_settlements', {
        p_period_start: start,
        p_period_end: end,
      });
      if (error) throw error;
      toast(`Generated ${data ?? 0} statement(s) for ${start} → ${end}`, 'success');
      await loadRows();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Generate failed', 'error');
    } finally {
      setBusy(false);
    }
  };

  const finalize = async (id: string) => {
    const supabase = createSupabaseBrowserClient();
    const { error } = await supabase.rpc('finalize_settlement', { p_settlement_id: id });
    if (error) {
      toast(error.message, 'error');
      return;
    }
    toast('Statement finalized', 'success');
    await loadRows();
  };

  const markPaid = async (id: string) => {
    const ref = window.prompt('Bank transfer reference for this payout?');
    if (ref === null) return;
    const supabase = createSupabaseBrowserClient();
    const { error } = await supabase.rpc('mark_settlement_paid', { p_settlement_id: id, p_reference: ref });
    if (error) {
      toast(error.message, 'error');
      return;
    }
    toast('Marked paid', 'success');
    await loadRows();
  };

  if (phase.state === 'loading') {
    return (
      <main className="min-h-screen bg-bg">
        <header className="flex items-center justify-between border-b border-line bg-white px-6 py-4">
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-8 w-20" />
        </header>
        <div className="mx-auto max-w-5xl space-y-3 p-6">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </div>
      </main>
    );
  }

  if (phase.state === 'unauthorized') {
    return (
      <main className="flex min-h-screen items-center justify-center bg-bg px-4 text-center">
        <div className="max-w-md">
          <h1 className="text-xl font-bold">Admin only</h1>
          <p className="mt-2 text-ink2">Restaurant settlements require an admin account.</p>
          <div className="mt-6 flex justify-center gap-3">
            <a href="/" className="rounded-lg border border-line px-4 py-2 text-sm font-semibold">
              Back to dispatch
            </a>
            <SignOutButton />
          </div>
        </div>
      </main>
    );
  }

  const totalPayable = rows.reduce((s, r) => s + r.net_payable_egp, 0);
  const totalCommission = rows.reduce((s, r) => s + r.commission_egp, 0);

  return (
    <main className="min-h-screen bg-bg">
      <header className="sticky top-0 z-10 flex items-center justify-between border-b border-line bg-white/90 px-6 py-4 backdrop-blur">
        <div>
          <div className="text-lg font-extrabold">
            Sharm Eats <span className="text-accent">Finance</span>
          </div>
          <div className="text-xs text-ink3">Restaurant settlements · {phase.displayName}</div>
        </div>
        <div className="flex items-center gap-3">
          <a
            href="/"
            className="rounded-lg border border-line px-3.5 py-2 text-sm font-semibold hover:border-accent hover:text-accent"
          >
            Dispatch
          </a>
          <SignOutButton />
        </div>
      </header>

      <div className="mx-auto max-w-5xl space-y-6 p-6">
        {/* Period controls */}
        <section className="flex flex-wrap items-end gap-4 rounded-2xl border border-line bg-white p-5">
          <label className="text-sm font-semibold">
            <span className="mb-1 block text-ink2">Period start (Sun)</span>
            <input
              type="date"
              value={start}
              onChange={(e) => setPeriod((p) => ({ ...p, start: e.target.value }))}
              className="rounded-lg border border-line px-3 py-2"
            />
          </label>
          <label className="text-sm font-semibold">
            <span className="mb-1 block text-ink2">Period end (Sat)</span>
            <input
              type="date"
              value={end}
              onChange={(e) => setPeriod((p) => ({ ...p, end: e.target.value }))}
              className="rounded-lg border border-line px-3 py-2"
            />
          </label>
          <button
            onClick={generate}
            disabled={busy}
            className="rounded-lg bg-accent px-4 py-2.5 text-sm font-bold text-white disabled:opacity-50"
          >
            {busy ? 'Generating…' : 'Generate statements'}
          </button>
          <button
            onClick={loadRows}
            className="rounded-lg border border-line px-4 py-2.5 text-sm font-semibold hover:border-accent"
          >
            Refresh
          </button>
        </section>

        {/* Totals */}
        {rows.length > 0 && (
          <section className="grid grid-cols-3 gap-4">
            <div className="rounded-2xl border border-line bg-white p-4">
              <div className="text-xs text-ink3">Statements</div>
              <div className="text-2xl font-extrabold">{rows.length}</div>
            </div>
            <div className="rounded-2xl border border-line bg-white p-4">
              <div className="text-xs text-ink3">Total commission (our revenue)</div>
              <div className="text-2xl font-extrabold text-accent">{money(totalCommission)}</div>
            </div>
            <div className="rounded-2xl border border-line bg-white p-4">
              <div className="text-xs text-ink3">Total net payable (card)</div>
              <div className="text-2xl font-extrabold">{money(totalPayable)}</div>
            </div>
          </section>
        )}

        {/* Statement list */}
        {rows.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-line bg-white p-10 text-center text-ink3">
            No statements for this period yet. Set the dates and press “Generate statements”.
          </div>
        ) : (
          <div className="overflow-hidden rounded-2xl border border-line bg-white">
            <table className="w-full text-sm">
              <thead className="border-b border-line bg-bg text-left text-xs uppercase text-ink3">
                <tr>
                  <th className="px-4 py-3">Restaurant</th>
                  <th className="px-4 py-3 text-right">Orders</th>
                  <th className="px-4 py-3 text-right">Gross</th>
                  <th className="px-4 py-3 text-right">Commission</th>
                  <th className="px-4 py-3 text-right">Net payable</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-b border-line last:border-0">
                    <td className="px-4 py-3 font-semibold">{r.restaurant_name}</td>
                    <td className="px-4 py-3 text-right">{r.order_count}</td>
                    <td className="px-4 py-3 text-right">{money(r.gross_sales_egp)}</td>
                    <td className="px-4 py-3 text-right text-accent">{money(r.commission_egp)}</td>
                    <td className="px-4 py-3 text-right font-bold">{money(r.net_payable_egp)}</td>
                    <td className="px-4 py-3">
                      <span
                        className={
                          'rounded-full px-2.5 py-1 text-xs font-bold ' +
                          (r.status === 'paid'
                            ? 'bg-green-100 text-green-700'
                            : r.status === 'finalized'
                              ? 'bg-amber-100 text-amber-700'
                              : 'bg-gray-100 text-gray-600')
                        }
                      >
                        {r.status}
                      </span>
                      {r.paid_reference && <span className="ml-2 text-xs text-ink3">{r.paid_reference}</span>}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {r.status === 'draft' && (
                        <button
                          onClick={() => finalize(r.id)}
                          className="rounded-lg border border-line px-3 py-1.5 text-xs font-semibold hover:border-accent hover:text-accent"
                        >
                          Finalize
                        </button>
                      )}
                      {r.status === 'finalized' && (
                        <button
                          onClick={() => markPaid(r.id)}
                          className="rounded-lg bg-accent px-3 py-1.5 text-xs font-bold text-white"
                        >
                          Mark paid
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </main>
  );
}
