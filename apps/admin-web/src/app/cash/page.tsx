'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';
import { toCsv } from '@/lib/csv';
import type { DriverCashBalance } from '@/lib/types';
import { SignOutButton } from '../SignOutButton';
import { useToast } from '../Toast';
import { Skeleton } from '../Skeleton';

type Phase =
  | { state: 'loading' }
  | { state: 'unauthorized' }
  | { state: 'ready'; displayName: string };

const money = (egp: number | null) => `${(egp ?? 0).toLocaleString('en-US')} EGP`;

export default function CashPage() {
  const router = useRouter();
  const { toast } = useToast();
  const [phase, setPhase] = useState<Phase>({ state: 'loading' });
  const [rows, setRows] = useState<DriverCashBalance[]>([]);

  const loadRows = useCallback(async () => {
    const supabase = createSupabaseBrowserClient();
    // Biggest cash-on-hand first — that's the reconciliation priority.
    const { data, error } = await supabase
      .from('driver_cash_balance')
      .select('*')
      .order('balance_egp', { ascending: false });
    if (error) {
      toast(error.message, 'error');
      return;
    }
    setRows((data ?? []) as DriverCashBalance[]);
  }, [toast]);

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

  // Record a cash hand-in: the driver physically gives collected COD cash back
  // to the platform, reducing their balance. The RPC returns the new balance.
  const recordHandin = async (row: DriverCashBalance) => {
    if (!row.driver_id) return;
    const raw = window.prompt(`Hand-in amount from ${row.driver_name ?? 'driver'} (EGP)?`);
    if (raw === null) return;
    const amount = Number(raw);
    if (!Number.isFinite(amount) || amount <= 0) {
      toast('Enter a positive amount', 'error');
      return;
    }
    const supabase = createSupabaseBrowserClient();
    const { data, error } = await supabase.rpc('record_cash_handin', {
      p_driver_id: row.driver_id,
      p_amount_egp: amount,
      p_reason: 'hand_in',
    });
    if (error) {
      toast(error.message, 'error');
      return;
    }
    toast(`Hand-in recorded · new balance ${money(data as number)}`, 'success');
    await loadRows();
  };

  // Manual signed adjustment (correction / write-off). A positive amount raises
  // the balance the driver owes; a negative amount lowers it.
  const recordAdjustment = async (row: DriverCashBalance) => {
    if (!row.driver_id) return;
    const raw = window.prompt(`Signed adjustment for ${row.driver_name ?? 'driver'} (EGP, may be negative)?`);
    if (raw === null) return;
    const amount = Number(raw);
    if (!Number.isFinite(amount) || amount === 0) {
      toast('Enter a non-zero amount', 'error');
      return;
    }
    const supabase = createSupabaseBrowserClient();
    const { data, error } = await supabase.rpc('record_cash_handin', {
      p_driver_id: row.driver_id,
      p_amount_egp: amount,
      p_reason: 'adjustment',
    });
    if (error) {
      toast(error.message, 'error');
      return;
    }
    toast(`Adjustment recorded · new balance ${money(data as number)}`, 'success');
    await loadRows();
  };

  const exportCsv = () => {
    if (rows.length === 0) {
      toast('No balances to export', 'error');
      return;
    }
    const header = [
      'driver',
      'balance_egp',
      'lifetime_collected_egp',
      'lifetime_handed_in_egp',
      'last_handin_at',
    ];
    const body = rows.map((r) => [
      r.driver_name ?? '',
      r.balance_egp ?? 0,
      r.lifetime_collected_egp ?? 0,
      r.lifetime_handed_in_egp ?? 0,
      r.last_handin_at ?? '',
    ]);
    const csv = toCsv(header, body);
    const stamp = new Date().toISOString().slice(0, 10);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `sharmeats-driver-cash-${stamp}.csv`;
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
          <p className="mt-2 text-ink2">Driver cash reconciliation requires an admin account.</p>
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

  const totalOutstanding = rows.reduce((s, r) => s + (r.balance_egp ?? 0), 0);
  const holdingCount = rows.filter((r) => (r.balance_egp ?? 0) > 0).length;

  return (
    <main className="min-h-screen bg-bg">
      <header className="sticky top-0 z-10 flex items-center justify-between border-b border-line bg-white/90 px-6 py-4 backdrop-blur">
        <div>
          <div className="text-lg font-extrabold">
            Sharm Eats <span className="text-accent">Cash</span>
          </div>
          <div className="text-xs text-ink3">Driver cash reconciliation · {phase.displayName}</div>
        </div>
        <div className="flex items-center gap-3">
          <a
            href="/driver-finance"
            className="rounded-lg border border-line px-3.5 py-2 text-sm font-semibold hover:border-accent hover:text-accent"
          >
            Driver Payouts
          </a>
          <a
            href="/finance"
            className="rounded-lg border border-line px-3.5 py-2 text-sm font-semibold hover:border-accent hover:text-accent"
          >
            Finance
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
        {/* Controls */}
        <section className="flex flex-wrap items-center gap-4 rounded-2xl border border-line bg-white p-5">
          <div className="text-sm text-ink2">
            Cash currently held by drivers, biggest first. Record a hand-in when a driver returns collected COD cash.
          </div>
          <div className="ml-auto flex gap-3">
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
          </div>
        </section>

        {/* Totals */}
        {rows.length > 0 && (
          <section className="grid grid-cols-3 gap-4">
            <div className="rounded-2xl border border-line bg-white p-4">
              <div className="text-xs text-ink3">Drivers</div>
              <div className="text-2xl font-extrabold">{rows.length}</div>
            </div>
            <div className="rounded-2xl border border-line bg-white p-4">
              <div className="text-xs text-ink3">Holding cash now</div>
              <div className="text-2xl font-extrabold">{holdingCount}</div>
            </div>
            <div className="rounded-2xl border border-line bg-white p-4">
              <div className="text-xs text-ink3">Total cash outstanding</div>
              <div className={'text-2xl font-extrabold ' + (totalOutstanding > 0 ? 'text-accent' : '')}>
                {money(totalOutstanding)}
              </div>
            </div>
          </section>
        )}

        {/* Balance list */}
        {rows.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-line bg-white p-10 text-center text-ink3">
            No driver cash activity yet.
          </div>
        ) : (
          <div className="overflow-hidden rounded-2xl border border-line bg-white">
            <table className="w-full text-sm">
              <thead className="border-b border-line bg-bg text-left text-xs uppercase text-ink3">
                <tr>
                  <th className="px-4 py-3">Driver</th>
                  <th className="px-4 py-3 text-right">Balance (cash held)</th>
                  <th className="px-4 py-3 text-right">Lifetime collected</th>
                  <th className="px-4 py-3 text-right">Lifetime handed in</th>
                  <th className="px-4 py-3">Last hand-in</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const balance = r.balance_egp ?? 0;
                  return (
                    <tr key={r.driver_id ?? r.driver_name} className="border-b border-line last:border-0">
                      <td className="px-4 py-3 font-semibold">{r.driver_name ?? 'Unknown'}</td>
                      <td
                        className={
                          'px-4 py-3 text-right font-bold ' +
                          (balance > 0 ? 'text-accent' : balance < 0 ? 'text-red-600' : '')
                        }
                      >
                        {money(balance)}
                      </td>
                      <td className="px-4 py-3 text-right">{money(r.lifetime_collected_egp)}</td>
                      <td className="px-4 py-3 text-right">{money(r.lifetime_handed_in_egp)}</td>
                      <td className="px-4 py-3 text-xs text-ink3">
                        {r.last_handin_at ? new Date(r.last_handin_at).toLocaleString('en-US') : '—'}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex justify-end gap-2">
                          <button
                            onClick={() => recordHandin(r)}
                            disabled={!r.driver_id}
                            className="rounded-lg bg-accent px-3 py-1.5 text-xs font-bold text-white disabled:opacity-50"
                          >
                            Record hand-in
                          </button>
                          <button
                            onClick={() => recordAdjustment(r)}
                            disabled={!r.driver_id}
                            className="rounded-lg border border-line px-3 py-1.5 text-xs font-semibold hover:border-accent hover:text-accent disabled:opacity-50"
                          >
                            Adjust
                          </button>
                        </div>
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
