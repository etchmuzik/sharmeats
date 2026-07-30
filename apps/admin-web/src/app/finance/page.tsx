'use client';

import Link from "next/link";
import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';
import { toCsv } from '@/lib/csv';
import type { RestaurantSettlement } from '@/lib/types';
import { AdminHeader } from '../AdminHeader';
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

/**
 * platform_revenue_report(date, date) — migration 126. The ONE correct blended
 * take-rate calculation: net revenue = third-party commission + own-brand food
 * revenue; own-brand commission_egp is an internal transfer and is never
 * summed. Blended and marketplace rates are BOTH shown — blended jumps once
 * own brands trade, and the investor-facing "marketplace take rate" is the
 * third-party number.
 */
interface RevenueReport {
  gmv_egp: number;
  third_party_gmv_egp: number;
  own_brand_gmv_egp: number;
  third_party_commission_egp: number;
  own_brand_revenue_egp: number;
  net_revenue_egp: number;
  blended_take_rate_pct: number | null;
  marketplace_take_rate_pct: number | null;
  third_party_orders: number;
  own_brand_orders: number;
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
  const [revenue, setRevenue] = useState<RevenueReport | null>(null);

  const loadRows = useCallback(async () => {
    const supabase = createSupabaseBrowserClient();
    // Clear the revenue panel up front: a failed reload must never leave the
    // PREVIOUS period's numbers rendered under the new period's header.
    setRevenue(null);
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

    // Platform revenue (mig 126). Settlements alone are now correct but
    // INCOMPLETE: own brands are excluded from settlement by design, so their
    // revenue only appears here.
    const { data: rev, error: revErr } = await supabase.rpc('platform_revenue_report', {
      p_period_start: start,
      p_period_end: end,
    });
    if (revErr) {
      // Only "the function does not exist" means the migration hasn't been
      // applied yet (web deploys independently of the DB) — hide the panel
      // quietly for that case alone. Anything else is a REAL failure and must
      // surface, or a transient error post-126 silently hides revenue.
      const missing =
        revErr.code === 'PGRST202' || /could not find the function/i.test(revErr.message);
      if (!missing) toast(`Revenue report failed: ${revErr.message}`, 'error');
      return;
    }
    const report = (Array.isArray(rev) ? rev[0] : rev) as RevenueReport | undefined;
    setRevenue(report ?? null);
  }, [start, end, toast]);

  // Customer compensation (mig 130). Accepts an order short code (resolves the
  // customer + links the credit to the order) or a raw user UUID. The paved
  // path since mig 101 revoked issue_credit from clients — before this card
  // the first cold-delivery complaint had no button behind it.
  const [creditTarget, setCreditTarget] = useState('');
  const [creditAmount, setCreditAmount] = useState('');
  const [creditReason, setCreditReason] = useState<'refund' | 'goodwill' | 'adjustment'>('goodwill');
  const [creditNote, setCreditNote] = useState('');
  const [creditBusy, setCreditBusy] = useState(false);

  const issueCredit = async () => {
    const target = creditTarget.trim();
    const amount = Number(creditAmount);
    if (!target) return toast('Enter an order code or user ID', 'error');
    if (!Number.isInteger(amount) || amount <= 0 || amount > 5000) {
      return toast('Amount must be 1–5000 EGP', 'error');
    }
    setCreditBusy(true);
    try {
      const supabase = createSupabaseBrowserClient();
      let userId = target;
      let orderId: string | null = null;
      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(target);
      if (!isUuid) {
        const { data: order, error: orderErr } = await supabase
          .from('orders')
          .select('id, user_id, short_code')
          .eq('short_code', target.toUpperCase())
          .maybeSingle();
        if (orderErr) throw orderErr;
        if (!order) return toast(`No order with code ${target.toUpperCase()}`, 'error');
        userId = order.user_id as string;
        orderId = order.id as string;
      }
      const { error } = await supabase.rpc('admin_issue_credit', {
        p_user_id: userId,
        p_amount_egp: amount,
        p_reason: creditReason,
        p_order_id: orderId,
        p_note: creditNote.trim() || null,
      });
      if (error) throw error;
      toast(`Credited ${amount} EGP (${creditReason})`, 'success');
      setCreditTarget('');
      setCreditAmount('');
      setCreditNote('');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Credit failed', 'error');
    } finally {
      setCreditBusy(false);
    }
  };

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

  // Serialize the currently loaded statements to CSV and trigger a browser
  // download so the weekly payout run can be pasted into the bank portal.
  const exportCsv = () => {
    if (rows.length === 0) {
      toast('No statements to export', 'error');
      return;
    }
    const header = [
      'restaurant',
      'period_start',
      'period_end',
      'order_count',
      'gross_sales_egp',
      'commission_egp',
      'net_payable_egp',
      'status',
      'paid_reference',
    ];
    const body = rows.map((r) => [
      r.restaurant_name,
      r.period_start,
      r.period_end,
      r.order_count,
      r.gross_sales_egp,
      r.commission_egp,
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
    a.download = `sharmeats-settlements-${stamp}.csv`;
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
          <p className="mt-2 text-ink2">Restaurant settlements require an admin account.</p>
          <div className="mt-6 flex justify-center gap-3">
            <Link href="/" className="rounded-lg border border-line px-4 py-2 text-sm font-semibold">
              Back to dispatch
            </Link>
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
      <AdminHeader
        title="Restaurant settlements"
        description="Weekly restaurant payouts"
        displayName={phase.displayName}
      />

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
            </div>
            <div className="rounded-2xl border border-line bg-white p-4">
              {/* Third-party only by design: own brands never get a settlement
                  row (mig 126), so this is marketplace commission — the full
                  revenue picture is the Platform revenue panel below. */}
              <div className="text-xs text-ink3">Third-party commission</div>
              <div className="text-2xl font-extrabold text-accent">{money(totalCommission)}</div>
            </div>
            <div className="rounded-2xl border border-line bg-white p-4">
              <div className="text-xs text-ink3">Total net payable (card)</div>
              <div className="text-2xl font-extrabold">{money(totalPayable)}</div>
            </div>
          </section>
        )}

        {/* Platform revenue (mig 126) — the one correct blended-take view.
            Own-brand revenue appears ONLY here: own brands are excluded from
            settlement so a self-payout can never be drafted. */}
        {revenue && revenue.gmv_egp > 0 && (
          <section className="rounded-2xl border border-line bg-white p-5">
            <div className="mb-3 flex items-baseline justify-between">
              <h2 className="text-sm font-bold uppercase tracking-wide text-ink2">
                Platform revenue
              </h2>
              <span className="text-xs text-ink3">
                delivered orders · {start} → {end}
              </span>
            </div>
            <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
              <div>
                <div className="text-xs text-ink3">Net revenue</div>
                <div className="text-2xl font-extrabold text-accent">{money(revenue.net_revenue_egp)}</div>
                <div className="text-[11px] text-ink3">
                  commission {money(revenue.third_party_commission_egp)} + own-brand{' '}
                  {money(revenue.own_brand_revenue_egp)}
                </div>
              </div>
              <div>
                <div className="text-xs text-ink3">GMV</div>
                <div className="text-2xl font-extrabold">{money(revenue.gmv_egp)}</div>
                <div className="text-[11px] text-ink3">
                  {revenue.third_party_orders} marketplace · {revenue.own_brand_orders} own-brand orders
                </div>
              </div>
              <div>
                <div className="text-xs text-ink3">Marketplace take rate</div>
                <div className="text-2xl font-extrabold">
                  {revenue.marketplace_take_rate_pct != null ? `${revenue.marketplace_take_rate_pct}%` : '—'}
                </div>
                <div className="text-[11px] text-ink3">third-party commission ÷ third-party GMV</div>
              </div>
              <div>
                <div className="text-xs text-ink3">Blended take rate</div>
                <div className="text-2xl font-extrabold">
                  {revenue.blended_take_rate_pct != null ? `${revenue.blended_take_rate_pct}%` : '—'}
                </div>
                {/* Not a margin: own-brand revenue carries food, labour and rent
                    costs that commission does not. Quote the marketplace rate
                    to investors; this one only with the kitchen cost base. */}
                <div className="text-[11px] text-ink3">revenue ÷ GMV — not a margin</div>
              </div>
            </div>
          </section>
        )}

        {/* Customer compensation (mig 130) — the paved make-it-right path. */}
        <section className="rounded-2xl border border-line bg-white p-5">
          <div className="mb-3 flex items-baseline justify-between">
            <h2 className="text-sm font-bold uppercase tracking-wide text-ink2">Issue customer credit</h2>
            <span className="text-xs text-ink3">refund / goodwill / adjustment · max 5,000 EGP per credit</span>
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <label className="text-sm font-semibold">
              <span className="mb-1 block text-ink2">Order code or user ID</span>
              <input
                value={creditTarget}
                onChange={(e) => setCreditTarget(e.target.value)}
                placeholder="e.g. SE-4F2K"
                className="w-44 rounded-lg border border-line px-3 py-2"
              />
            </label>
            <label className="text-sm font-semibold">
              <span className="mb-1 block text-ink2">Amount (EGP)</span>
              <input
                type="number"
                min={1}
                max={5000}
                value={creditAmount}
                onChange={(e) => setCreditAmount(e.target.value)}
                className="w-28 rounded-lg border border-line px-3 py-2"
              />
            </label>
            <label className="text-sm font-semibold">
              <span className="mb-1 block text-ink2">Reason</span>
              <select
                value={creditReason}
                onChange={(e) => setCreditReason(e.target.value as 'refund' | 'goodwill' | 'adjustment')}
                className="rounded-lg border border-line px-3 py-2"
              >
                <option value="goodwill">Goodwill</option>
                <option value="refund">Refund</option>
                <option value="adjustment">Adjustment</option>
              </select>
            </label>
            <label className="grow text-sm font-semibold">
              <span className="mb-1 block text-ink2">Note (internal)</span>
              <input
                value={creditNote}
                onChange={(e) => setCreditNote(e.target.value)}
                placeholder="e.g. cold delivery, order remade"
                className="w-full rounded-lg border border-line px-3 py-2"
              />
            </label>
            <button
              onClick={issueCredit}
              disabled={creditBusy}
              className="rounded-lg bg-accent px-4 py-2.5 text-sm font-bold text-white disabled:opacity-50"
            >
              {creditBusy ? 'Crediting…' : 'Issue credit'}
            </button>
          </div>
        </section>

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
