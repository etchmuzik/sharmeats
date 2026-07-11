'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';
import { toCsv } from '@/lib/csv';
import type { DriverSettlement } from '@/lib/types';
import { SignOutButton } from '../SignOutButton';
import { useToast } from '../Toast';
import { Skeleton } from '../Skeleton';

type Phase =
  | { state: 'loading' }
  | { state: 'unauthorized' }
  | { state: 'ready'; displayName: string };

interface Row extends DriverSettlement {
  driver_name: string;
}

// Default the period to the most recent complete Sun–Sat week — the same weekly
// payout cadence as the restaurant settlements page. Returns ISO yyyy-mm-dd.
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

export default function DriverFinancePage() {
  const router = useRouter();
  const { toast } = useToast();
  const [phase, setPhase] = useState<Phase>({ state: 'loading' });
  const [{ start, end }, setPeriod] = useState(lastWeek());
  const [rows, setRows] = useState<Row[]>([]);
  const [busy, setBusy] = useState(false);

  const loadRows = useCallback(async () => {
    const supabase = createSupabaseBrowserClient();
    // Statements for the selected period, joined to driver name.
    const { data, error } = await supabase
      .from('driver_settlements')
      .select('*, drivers(name)')
      .eq('period_start', start)
      .eq('period_end', end)
      .order('net_payable_egp', { ascending: false });
    if (error) {
      toast(error.message, 'error');
      return;
    }
    const mapped = (data ?? []).map((r) => {
      const rec = r as DriverSettlement & { drivers: { name: string } | null };
      return { ...rec, driver_name: rec.drivers?.name ?? 'Unknown' };
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
      const { data, error } = await supabase.rpc('generate_driver_settlements', {
        p_period_start: start,
        p_period_end: end,
      });
      if (error) throw error;
      toast(`Generated ${data ?? 0} driver statement(s) for ${start} → ${end}`, 'success');
      await loadRows();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Generate failed', 'error');
    } finally {
      setBusy(false);
    }
  };

  const finalize = async (id: string) => {
    const supabase = createSupabaseBrowserClient();
    const { error } = await supabase.rpc('finalize_driver_settlement', { p_settlement_id: id });
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
    const { error } = await supabase.rpc('mark_driver_settlement_paid', { p_settlement_id: id, p_reference: ref });
    if (error) {
      toast(error.message, 'error');
      return;
    }
    toast('Marked paid', 'success');
    await loadRows();
  };

  // Serialize the currently loaded statements to CSV and trigger a browser
  // download so the weekly driver-payout run can be pasted into the bank portal.
  const exportCsv = () => {
    if (rows.length === 0) {
      toast('No statements to export', 'error');
      return;
    }
    const header = [
      'driver',
      'period_start',
      'period_end',
      'delivery_count',
      'gross_earnings_egp',
      'cod_collected_egp',
      'net_payable_egp',
      'status',
      'paid_reference',
    ];
    const body = rows.map((r) => [
      r.driver_name,
      r.period_start,
      r.period_end,
      r.delivery_count,
      r.gross_earnings_egp,
      r.cod_collected_egp,
      r.net_payable_egp,
      r.status,
      r.paid_reference ?? '',
    ]);
    const csv = toCsv(header, body);
    const stamp = start || new Date().toISOString().slice(0, 10);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `sharmeats-driver-settlements-${stamp}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
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
          <p className="mt-2 text-ink2">Driver payouts require an admin account.</p>
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
  const totalCod = rows.reduce((s, r) => s + r.cod_collected_egp, 0);
  const owingCount = rows.filter((r) => r.net_payable_egp < 0).length;

  return (
    <main className="min-h-screen bg-bg">
      <header className="sticky top-0 z-10 flex items-center justify-between border-b border-line bg-white/90 px-6 py-4 backdrop-blur">
        <div>
          <div className="text-lg font-extrabold">
            Sharm Eats <span className="text-accent">Driver Payouts</span>
          </div>
          <div className="text-xs text-ink3">Driver settlements · {phase.displayName}</div>
        </div>
        <div className="flex items-center gap-3">
          <a
            href="/finance"
            className="rounded-lg border border-line px-3.5 py-2 text-sm font-semibold hover:border-accent hover:text-accent"
          >
            Finance
          </a>
          <a
            href="/cash"
            className="rounded-lg border border-line px-3.5 py-2 text-sm font-semibold hover:border-accent hover:text-accent"
          >
            Cash
          </a>
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
            {busy ? 'Generating…' : 'Generate driver statements'}
          </button>
          <button
            onClick={loadRows}
            className="rounded-lg border border-line px-4 py-2.5 text-sm font-semibold hover:border-accent"
          >
            Refresh
          </button>
          <button
            onClick={exportCsv}
            disabled={rows.length === 0}
            className="rounded-lg border border-line px-4 py-2.5 text-sm font-semibold hover:border-accent disabled:opacity-50"
          >
            Export CSV
          </button>
        </section>

        {/* Totals */}
        {rows.length > 0 && (
          <section className="grid grid-cols-3 gap-4">
            <div className="rounded-2xl border border-line bg-white p-4">
              <div className="text-xs text-ink3">Statements</div>
              <div className="text-2xl font-extrabold">{rows.length}</div>
              {owingCount > 0 && (
                <div className="mt-1 text-xs font-semibold text-red-600">{owingCount} owe platform</div>
              )}
            </div>
            <div className="rounded-2xl border border-line bg-white p-4">
              <div className="text-xs text-ink3">Total COD collected</div>
              <div className="text-2xl font-extrabold">{money(totalCod)}</div>
            </div>
            <div className="rounded-2xl border border-line bg-white p-4">
              <div className="text-xs text-ink3">Total net payable</div>
              <div className={'text-2xl font-extrabold ' + (totalPayable < 0 ? 'text-red-600' : '')}>
                {money(totalPayable)}
              </div>
            </div>
          </section>
        )}

        {/* Statement list */}
        {rows.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-line bg-white p-10 text-center text-ink3">
            No driver statements for this period yet. Set the dates and press “Generate driver statements”.
          </div>
        ) : (
          <div className="overflow-hidden rounded-2xl border border-line bg-white">
            <table className="w-full text-sm">
              <thead className="border-b border-line bg-bg text-left text-xs uppercase text-ink3">
                <tr>
                  <th className="px-4 py-3">Driver</th>
                  <th className="px-4 py-3 text-right">Deliveries</th>
                  <th className="px-4 py-3 text-right">Gross earnings</th>
                  <th className="px-4 py-3 text-right">COD collected</th>
                  <th className="px-4 py-3 text-right">Net payable (− = owes us)</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const owes = r.net_payable_egp < 0;
                  return (
                    <tr key={r.id} className="border-b border-line last:border-0">
                      <td className="px-4 py-3 font-semibold">{r.driver_name}</td>
                      <td className="px-4 py-3 text-right">{r.delivery_count}</td>
                      <td className="px-4 py-3 text-right">{money(r.gross_earnings_egp)}</td>
                      <td className="px-4 py-3 text-right">{money(r.cod_collected_egp)}</td>
                      <td className={'px-4 py-3 text-right font-bold ' + (owes ? 'text-red-600' : '')}>
                        {money(r.net_payable_egp)}
                      </td>
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
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </main>
  );
}
