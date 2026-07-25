'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';
import { toCsv } from '@/lib/csv';
import { SignOutButton } from '../SignOutButton';
import { useToast } from '../Toast';
import { Skeleton } from '../Skeleton';

/**
 * Founding-rate expiry report (mig 125).
 *
 * The LOI gives the founding cohort a reduced commission for 3 months from
 * go-live, after which the standard 15% applies (docs/FINANCIALS.md). Without
 * this page a discounted rate simply runs forever, unnoticed. The report is
 * READ-ONLY except for two deliberate admin actions — set the expiry date, and
 * move a restaurant to the standard rate — because changing a merchant's
 * commercial terms should always be a human decision, never a cron job.
 *
 * All computation (status, days remaining, forgone commission) happens in the
 * founding_rate_report() RPC so the numbers cannot drift between UI and DB.
 */

type Phase =
  | { state: 'loading' }
  | { state: 'unauthorized' }
  | { state: 'error' }
  | { state: 'ready'; displayName: string };

type Status = 'expired' | 'expiring_soon' | 'active' | 'no_expiry_set' | 'standard';

interface ReportRow {
  restaurant_id: string;
  name: string;
  zone: string;
  is_active: boolean;
  commission_pct: number;
  founding_rate_until: string | null;
  days_remaining: number | null;
  status: Status;
  delivered_orders: number;
  food_egp_30d: number;
  forgone_egp_30d: number;
}

const STANDARD_PCT = 15;

const STATUS_LABEL: Record<Status, string> = {
  expired: 'Expired',
  expiring_soon: 'Expiring soon',
  active: 'In window',
  no_expiry_set: 'No expiry set',
  standard: 'Standard rate',
};

// Tailwind classes per status — expired/expiring are the ones that need action.
const STATUS_CLASS: Record<Status, string> = {
  expired: 'border-red-500 text-red-700',
  expiring_soon: 'border-amber-500 text-amber-700',
  active: 'border-green-500 text-green-700',
  no_expiry_set: 'border-line text-ink2',
  standard: 'border-line text-ink2',
};

const money = (egp: number) => `${egp.toLocaleString('en-US')} EGP`;

function daysLabel(row: ReportRow): string {
  if (row.days_remaining === null) return '—';
  if (row.days_remaining < 0) return `${Math.abs(row.days_remaining)}d ago`;
  if (row.days_remaining === 0) return 'today';
  return `in ${row.days_remaining}d`;
}

export default function FoundingRatesPage() {
  const router = useRouter();
  const { toast } = useToast();
  const [phase, setPhase] = useState<Phase>({ state: 'loading' });
  const [rows, setRows] = useState<ReportRow[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);

  const loadRows = useCallback(async () => {
    const supabase = createSupabaseBrowserClient();
    const { data, error } = await supabase.rpc('founding_rate_report');
    if (error) {
      toast(error.message, 'error');
      return false;
    }
    setRows((data as ReportRow[]) ?? []);
    return true;
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
      const { data: me, error } = await supabase
        .from('users')
        .select('role, display_name')
        .eq('id', session.user.id)
        .single();
      if (error) {
        if (!cancelled) setPhase({ state: 'error' });
        return;
      }
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

  /** Set (or clear) the founding-window end date for one restaurant. */
  async function setExpiry(row: ReportRow) {
    const current = row.founding_rate_until ?? '';
    const raw = window.prompt(
      `Founding rate ends for ${row.name} (YYYY-MM-DD).\nLeave blank to clear.`,
      current,
    );
    if (raw === null) return; // cancelled
    const trimmed = raw.trim();
    if (trimmed !== '' && !/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
      toast('Enter a date as YYYY-MM-DD, or leave blank to clear.', 'error');
      return;
    }
    setBusyId(row.restaurant_id);
    const supabase = createSupabaseBrowserClient();
    const { error } = await supabase.rpc('admin_set_founding_rate_until', {
      p_restaurant_id: row.restaurant_id,
      p_until: trimmed === '' ? null : trimmed,
    });
    setBusyId(null);
    if (error) {
      toast(
        error.message.includes('INVALID_DATE')
          ? 'That date is too far in the future — check the year.'
          : `Failed: ${error.message}`,
        'error',
      );
      return;
    }
    toast(trimmed === '' ? `Cleared window for ${row.name}` : `${row.name} → ends ${trimmed}`, 'success');
    loadRows();
  }

  /** Move a restaurant onto the standard rate. Always confirmed by a human. */
  async function moveToStandard(row: ReportRow) {
    if (
      !window.confirm(
        `Move ${row.name} from ${row.commission_pct}% to the standard ${STANDARD_PCT}%?\n\n` +
          `This changes what they are charged on every future order. Tell the restaurant before you do this.`,
      )
    ) {
      return;
    }
    setBusyId(row.restaurant_id);
    const supabase = createSupabaseBrowserClient();
    const { error } = await supabase.rpc('admin_set_commission', {
      p_restaurant_id: row.restaurant_id,
      p_pct: STANDARD_PCT,
    });
    if (!error) {
      // The window is done once they're on standard — clear it so the row leaves the queue.
      await supabase.rpc('admin_set_founding_rate_until', {
        p_restaurant_id: row.restaurant_id,
        p_until: null,
      });
    }
    setBusyId(null);
    if (error) {
      toast(`Failed: ${error.message}`, 'error');
      return;
    }
    toast(`${row.name} is now on ${STANDARD_PCT}%`, 'success');
    loadRows();
  }

  function exportCsv() {
    const csv = toCsv(
      [
        'restaurant',
        'zone',
        'active',
        'commission_pct',
        'founding_rate_until',
        'days_remaining',
        'status',
        'delivered_orders',
        'food_egp_30d',
        'forgone_egp_30d',
      ],
      rows.map((r) => [
        r.name,
        r.zone,
        r.is_active ? 'yes' : 'no',
        r.commission_pct,
        r.founding_rate_until ?? '',
        r.days_remaining ?? '',
        r.status,
        r.delivered_orders,
        r.food_egp_30d,
        r.forgone_egp_30d,
      ]),
    );
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `founding-rates-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  if (phase.state === 'loading') return <Skeleton />;
  if (phase.state === 'unauthorized') {
    return (
      <main className="p-6">
        <p className="text-sm">Admin account required.</p>
      </main>
    );
  }
  if (phase.state === 'error') {
    return (
      <main className="mx-auto max-w-lg p-6">
        <p className="text-sm">Could not load the report.</p>
        <button className="mt-3 rounded-lg border px-3 py-1 text-sm font-bold" onClick={() => location.reload()}>
          Retry
        </button>
      </main>
    );
  }

  const needsAction = rows.filter((r) => r.status === 'expired' || r.status === 'expiring_soon');
  const forgoneTotal = rows.reduce((sum, r) => sum + (r.forgone_egp_30d ?? 0), 0);
  const belowStandard = rows.filter((r) => r.commission_pct < STANDARD_PCT).length;

  return (
    <main className="mx-auto max-w-5xl p-6">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-2xl font-extrabold">Founding rates</h1>
        <div className="flex items-center gap-3">
          <Link className="underline" href="/">
            Home
          </Link>
          <SignOutButton />
        </div>
      </div>

      <p className="mb-4 text-sm text-ink2">
        Restaurants paying below the standard {STANDARD_PCT}%. The founding rate runs for a fixed
        window from go-live (LOI: 3 months); this page shows when each window ends. Rates never
        change on their own — you move a restaurant to standard yourself.
      </p>

      <div className="mb-4 flex flex-wrap gap-3">
        <div className="rounded-xl border px-4 py-3 text-sm">
          <div className="font-extrabold">{belowStandard}</div>
          <div className="text-ink2">below {STANDARD_PCT}%</div>
        </div>
        <div className="rounded-xl border px-4 py-3 text-sm">
          <div className="font-extrabold">{needsAction.length}</div>
          <div className="text-ink2">expired or expiring</div>
        </div>
        <div className="rounded-xl border px-4 py-3 text-sm">
          <div className="font-extrabold">{money(forgoneTotal)}</div>
          <div className="text-ink2">discount cost / 30d</div>
        </div>
        {rows.length > 0 && (
          <button className="rounded-xl border px-4 py-3 text-sm font-bold" onClick={exportCsv}>
            Export CSV
          </button>
        )}
      </div>

      {rows.length === 0 && (
        <p className="text-sm text-ink2">Every restaurant is on the standard rate. 🌴</p>
      )}

      <ul className="flex flex-col gap-3">
        {rows.map((row) => (
          <li key={row.restaurant_id} className="rounded-xl border p-4 text-sm">
            <div className="flex items-center justify-between gap-3">
              <p className="font-extrabold">
                {row.name}
                {!row.is_active && <span className="ml-2 font-normal text-ink2">(inactive)</span>}
              </p>
              <span className={`rounded-full border px-2 py-0.5 text-xs ${STATUS_CLASS[row.status]}`}>
                {STATUS_LABEL[row.status]}
              </span>
            </div>
            <p className="text-ink2">
              {row.zone} · <span className="font-bold">{row.commission_pct}%</span> commission ·{' '}
              {row.delivered_orders} delivered
            </p>

            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
              <span className="rounded-full border px-2 py-0.5">
                ends: {row.founding_rate_until ?? 'not set'}
                {row.founding_rate_until && ` (${daysLabel(row)})`}
              </span>
              <span className="rounded-full border px-2 py-0.5">
                30d food: {money(row.food_egp_30d)}
              </span>
              <span className="rounded-full border px-2 py-0.5">
                discount cost: {money(row.forgone_egp_30d)}/30d
              </span>
            </div>

            <div className="mt-3 flex flex-wrap gap-2">
              <button
                className="rounded-lg border px-3 py-1 font-bold disabled:opacity-40"
                disabled={busyId === row.restaurant_id}
                onClick={() => setExpiry(row)}
              >
                {row.founding_rate_until ? 'Change end date' : 'Set end date'}
              </button>
              {row.commission_pct < STANDARD_PCT && (
                <button
                  className="rounded-lg bg-ink px-3 py-1 font-bold text-white disabled:opacity-40"
                  disabled={busyId === row.restaurant_id}
                  title={
                    row.status === 'expired'
                      ? 'This restaurant’s founding window has ended'
                      : 'Ends their founding rate early — tell them first'
                  }
                  onClick={() => moveToStandard(row)}
                >
                  {busyId === row.restaurant_id ? '…' : `Move to ${STANDARD_PCT}%`}
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>
    </main>
  );
}
