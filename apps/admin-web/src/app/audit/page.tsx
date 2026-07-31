'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';
import { captureError } from '@/lib/sentry';
import { toCsv } from '@/lib/csv';
import { SignOutButton } from '../SignOutButton';
import { useToast } from '../Toast';
import { Skeleton } from '../Skeleton';

/**
 * Money-out audit — a readable view of what this dashboard has paid out.
 *
 * WHY: a new restaurant application pings Telegram. Issuing 5,000 EGP of
 * customer credit pings nothing, and there was no screen anywhere that could
 * answer "what went out today, and who sent it". The records existed the whole
 * time — every money-out path writes an append-only ledger row with an actor —
 * but the only way to read them was psql.
 *
 * This page DESIGNS NO NEW STORAGE. It reads what migrations 062, 104, 074 and
 * 105 already record:
 *   credit_ledger        customer credit grants (actor_id = the admin, null = SLA engine)
 *   driver_cash_ledger   hand-ins, adjustments and write-offs (actor_id = whoever recorded it)
 *   restaurant_settlements / driver_settlements  payouts marked paid
 *
 * The gap it CANNOT close is stated on the page rather than hidden: settlement
 * payouts record paid_at and a bank reference but no actor, and commission
 * changes (admin_set_commission) record nothing at all. Both need a server
 * change, not a screen.
 */

type Phase =
  | { state: 'loading' }
  | { state: 'unauthorized' }
  | { state: 'ready'; displayName: string };

type WindowDays = 1 | 7 | 30;

/** What kind of money-out this was. Drives the badge and the totals. */
type EntryKind = 'credit' | 'cash_writeoff' | 'cash_adjustment' | 'settlement_paid';

interface AuditEntry {
  id: string;
  kind: EntryKind;
  at: string;
  /** Positive EGP leaving the platform. Never negative — direction is in `kind`. */
  amountEgp: number;
  /** Who received it: a customer, a driver, a restaurant. */
  subject: string;
  /** Who did it, or null when no actor was recorded (see the caveat banner). */
  actor: string | null;
  detail: string;
}

const KIND_LABEL: Record<EntryKind, string> = {
  credit: 'Customer credit',
  cash_writeoff: 'Cash write-off',
  cash_adjustment: 'Cash adjustment',
  settlement_paid: 'Payout marked paid',
};

const KIND_CLASS: Record<EntryKind, string> = {
  credit: 'border-amber-500 text-amber-700',
  cash_writeoff: 'border-red-500 text-red-700',
  cash_adjustment: 'border-line text-ink2',
  settlement_paid: 'border-green-500 text-green-700',
};

/** Rows per source. A bound, not a page size: this is a review screen, not an archive. */
const ROW_LIMIT = 500;

const money = (egp: number) => `${Math.round(egp).toLocaleString('en-US')} EGP`;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const shortId = (id: string) => (UUID.test(id) ? id.slice(0, 8) : id);

interface CreditRow {
  id: number;
  user_id: string;
  delta_egp: number;
  reason: string;
  note: string | null;
  actor_id: string | null;
  created_at: string;
}

interface CashRow {
  id: string;
  driver_id: string;
  delta_egp: number;
  reason: string;
  note: string | null;
  actor_id: string | null;
  created_at: string;
}

interface PaidSettlementRow {
  id: string;
  net_payable_egp: number;
  paid_at: string | null;
  paid_reference: string | null;
  period_start: string;
  period_end: string;
}

/**
 * PostgREST returns an embedded row as an object or, depending on how it reads
 * the relationship, a one-element array. Handle both rather than betting on
 * one and rendering "Unknown" for every payout the day it changes.
 */
function joinedName(value: unknown): string | null {
  const record = Array.isArray(value) ? value[0] : value;
  if (record && typeof record === 'object' && 'name' in record) {
    const name = (record as { name: unknown }).name;
    if (typeof name === 'string' && name) return name;
  }
  return null;
}

/** Paid settlements from either table into the shared audit shape. */
function toPayoutEntries(rows: unknown, joinKey: 'restaurants' | 'drivers'): AuditEntry[] {
  return ((rows ?? []) as (PaidSettlementRow & Record<string, unknown>)[]).map((r) => ({
    id: `settlement:${r.id}`,
    kind: 'settlement_paid' as const,
    at: r.paid_at ?? r.period_end,
    amountEgp: r.net_payable_egp,
    subject: joinedName(r[joinKey]) ?? 'Unknown',
    // No actor column exists on either settlements table — see the caveat
    // banner. Showing null is honest; inventing one is not.
    actor: null,
    detail: [`${r.period_start} → ${r.period_end}`, r.paid_reference].filter(Boolean).join(' · '),
  }));
}

export default function MoneyAuditPage() {
  const router = useRouter();
  const { toast } = useToast();
  const [phase, setPhase] = useState<Phase>({ state: 'loading' });
  const [days, setDays] = useState<WindowDays>(7);
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [truncated, setTruncated] = useState(false);

  const load = useCallback(async () => {
    const supabase = createSupabaseBrowserClient();
    const since = new Date(Date.now() - days * 24 * 3600_000).toISOString();

    const [credits, cash, restaurantPayouts, driverPayouts] = await Promise.all([
      supabase
        .from('credit_ledger')
        .select('id, user_id, delta_egp, reason, note, actor_id, created_at')
        .gt('delta_egp', 0)
        .gte('created_at', since)
        .order('created_at', { ascending: false })
        .limit(ROW_LIMIT),
      supabase
        .from('driver_cash_ledger')
        .select('id, driver_id, delta_egp, reason, note, actor_id, created_at')
        .in('reason', ['adjustment', 'write_off'])
        .gte('created_at', since)
        .order('created_at', { ascending: false })
        .limit(ROW_LIMIT),
      supabase
        .from('restaurant_settlements')
        .select('id, net_payable_egp, paid_at, paid_reference, period_start, period_end, restaurants(name)')
        .eq('status', 'paid')
        .gte('paid_at', since)
        .order('paid_at', { ascending: false })
        .limit(ROW_LIMIT),
      supabase
        .from('driver_settlements')
        .select('id, net_payable_egp, paid_at, paid_reference, period_start, period_end, drivers(name)')
        .eq('status', 'paid')
        .gte('paid_at', since)
        .order('paid_at', { ascending: false })
        .limit(ROW_LIMIT),
    ]);

    // One failing source must not blank the whole screen — but it must be said
    // out loud, because an audit view that quietly omits a category is worse
    // than no audit view.
    const failures = [credits.error, cash.error, restaurantPayouts.error, driverPayouts.error].filter(
      (e): e is NonNullable<typeof e> => Boolean(e),
    );
    for (const error of failures) {
      captureError(error, { surface: 'admin-web', screen: 'audit', action: 'load', windowDays: days });
    }
    if (failures.length > 0) {
      toast(
        `${failures.length} of 4 money-out sources failed to load — this list is incomplete. ${failures[0].message}`,
        'error',
      );
    }

    const creditRows = (credits.data ?? []) as CreditRow[];
    const cashRows = (cash.data ?? []) as CashRow[];

    // Names: users are self-only under RLS, so the admin-gated definer RPC
    // (mig 098) is the only way to turn an id into a name. Drivers admins can
    // read directly (drivers_self_select has an admin arm).
    const userIds = [
      ...new Set([
        ...creditRows.map((r) => r.user_id),
        ...creditRows.map((r) => r.actor_id),
        ...cashRows.map((r) => r.actor_id),
      ].filter((id): id is string => Boolean(id))),
    ];
    const driverIds = [...new Set(cashRows.map((r) => r.driver_id))];

    const names = new Map<string, string>();
    if (userIds.length > 0) {
      const { data: users, error } = await supabase.rpc('admin_resolve_user_names', { p_ids: userIds });
      if (error) {
        captureError(error, { surface: 'admin-web', screen: 'audit', action: 'admin_resolve_user_names' });
      }
      for (const u of (users ?? []) as { id: string; display_name: string | null }[]) {
        if (u.display_name) names.set(u.id, u.display_name);
      }
    }
    if (driverIds.length > 0) {
      const { data: drivers, error } = await supabase.from('drivers').select('id, name').in('id', driverIds);
      if (error) {
        captureError(error, { surface: 'admin-web', screen: 'audit', action: 'resolve_driver_names' });
      }
      for (const d of (drivers ?? []) as { id: string; name: string | null }[]) {
        if (d.name) names.set(d.id, d.name);
      }
    }

    const named = (id: string | null): string | null =>
      id === null ? null : names.get(id) ?? shortId(id);

    const creditEntries: AuditEntry[] = creditRows.map((r) => ({
      id: `credit:${r.id}`,
      kind: 'credit',
      at: r.created_at,
      amountEgp: r.delta_egp,
      subject: named(r.user_id) ?? 'Unknown',
      // A null actor on a credit is not a missing record: sla_late credits are
      // machine-issued by the delivery trigger and have never had one.
      actor: r.actor_id ? named(r.actor_id) : r.reason === 'sla_late' ? 'system (SLA)' : null,
      detail: [r.reason, r.note].filter(Boolean).join(' · '),
    }));

    const cashEntries: AuditEntry[] = cashRows.map((r) => ({
      id: `cash:${r.id}`,
      kind: r.reason === 'write_off' ? 'cash_writeoff' : 'cash_adjustment',
      at: r.created_at,
      // A NEGATIVE delta forgives cash the driver owes us, which is money out.
      // A positive one raises what they owe. Both are shown; the sign is kept
      // in the amount column so a correction is not read as a loss.
      amountEgp: -r.delta_egp,
      subject: named(r.driver_id) ?? 'Unknown driver',
      actor: named(r.actor_id),
      detail: [r.reason, r.note].filter(Boolean).join(' · '),
    }));

    const payoutEntries = [
      ...toPayoutEntries(restaurantPayouts.data, 'restaurants'),
      ...toPayoutEntries(driverPayouts.data, 'drivers'),
    ];

    const all = [...creditEntries, ...cashEntries, ...payoutEntries].sort((a, b) =>
      b.at.localeCompare(a.at),
    );
    setEntries(all);
    setTruncated(
      [credits.data, cash.data, restaurantPayouts.data, driverPayouts.data].some(
        (rows) => (rows?.length ?? 0) >= ROW_LIMIT,
      ),
    );
  }, [days, toast]);

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
      const { data: me } = await supabase
        .from('users')
        .select('role, display_name')
        .eq('id', session.user.id)
        .single();
      if ((me?.role as string | undefined) !== 'admin') {
        if (!cancelled) setPhase({ state: 'unauthorized' });
        return;
      }
      if (!cancelled) setPhase({ state: 'ready', displayName: me?.display_name ?? 'Admin' });
    })();
    return () => {
      cancelled = true;
    };
  }, [router]);

  useEffect(() => {
    if (phase.state === 'ready') load();
  }, [phase.state, load]);

  /**
   * Totals per category, plus credit issued per actor — the closest thing to
   * the aggregate cap this platform does not have. Nothing here BLOCKS a
   * payout; it makes an unusual day visible to a human on the same screen
   * where the payouts happen.
   */
  const totals = useMemo(() => {
    const byKind = new Map<EntryKind, number>();
    const creditByActor = new Map<string, number>();
    for (const e of entries) {
      byKind.set(e.kind, (byKind.get(e.kind) ?? 0) + e.amountEgp);
      if (e.kind === 'credit') {
        const who = e.actor ?? 'unattributed';
        creditByActor.set(who, (creditByActor.get(who) ?? 0) + e.amountEgp);
      }
    }
    return {
      byKind,
      creditByActor: [...creditByActor.entries()].sort((a, b) => b[1] - a[1]),
      creditTotal: byKind.get('credit') ?? 0,
      outTotal:
        (byKind.get('credit') ?? 0) +
        (byKind.get('settlement_paid') ?? 0) +
        Math.max(byKind.get('cash_writeoff') ?? 0, 0) +
        Math.max(byKind.get('cash_adjustment') ?? 0, 0),
    };
  }, [entries]);

  const exportCsv = () => {
    if (entries.length === 0) {
      toast('Nothing to export for this window', 'error');
      return;
    }
    const csv = toCsv(
      ['at', 'kind', 'subject', 'amount_egp', 'actor', 'detail'],
      entries.map((e) => [e.at, KIND_LABEL[e.kind], e.subject, e.amountEgp, e.actor ?? '', e.detail]),
    );
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `sharmeats-money-out-${days}d-${new Date().toISOString().slice(0, 10)}.csv`;
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
          <p className="mt-2 text-ink2">The money-out audit requires an admin account.</p>
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

  return (
    <main className="min-h-screen bg-bg">
      <header className="sticky top-0 z-10 flex items-center justify-between border-b border-line bg-white/90 px-6 py-4 backdrop-blur">
        <div>
          <div className="text-lg font-extrabold">Money out</div>
          <div className="text-xs text-ink3">Audit of paid-out actions · {phase.displayName}</div>
        </div>
      </header>

      <div className="mx-auto max-w-5xl space-y-6 p-6">
        <section className="flex flex-wrap items-center gap-3 rounded-2xl border border-line bg-white p-5">
          <div className="text-sm text-ink2">
            Everything this dashboard has paid out, newest first, from the ledgers that already
            record it.
          </div>
          <div className="ml-auto flex gap-2">
            {([1, 7, 30] as const).map((d) => (
              <button
                key={d}
                onClick={() => setDays(d)}
                className={`rounded-lg px-3.5 py-2 text-sm font-semibold ${
                  days === d ? 'bg-accent text-white' : 'border border-line'
                }`}
              >
                {d === 1 ? '24 hours' : `${d} days`}
              </button>
            ))}
            <button
              onClick={load}
              className="rounded-lg border border-line px-3.5 py-2 text-sm font-semibold hover:border-accent"
            >
              Refresh
            </button>
            <button
              onClick={exportCsv}
              disabled={entries.length === 0}
              className="rounded-lg border border-line px-3.5 py-2 text-sm font-semibold hover:border-accent disabled:opacity-50"
            >
              Export CSV
            </button>
          </div>
        </section>

        <section className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <div className="rounded-2xl border border-line bg-white p-4">
            <div className="text-xs text-ink3">Total out</div>
            <div className="text-2xl font-extrabold text-accent">{money(totals.outTotal)}</div>
          </div>
          <div className="rounded-2xl border border-line bg-white p-4">
            <div className="text-xs text-ink3">Customer credit</div>
            <div className="text-2xl font-extrabold">{money(totals.creditTotal)}</div>
          </div>
          <div className="rounded-2xl border border-line bg-white p-4">
            <div className="text-xs text-ink3">Payouts marked paid</div>
            <div className="text-2xl font-extrabold">
              {money(totals.byKind.get('settlement_paid') ?? 0)}
            </div>
          </div>
          <div className="rounded-2xl border border-line bg-white p-4">
            <div className="text-xs text-ink3">Cash forgiven</div>
            <div className="text-2xl font-extrabold">
              {money(Math.max(totals.byKind.get('cash_writeoff') ?? 0, 0))}
            </div>
          </div>
        </section>

        {totals.creditByActor.length > 0 && (
          <section className="rounded-2xl border border-line bg-white p-5">
            <h2 className="mb-2 text-sm font-bold uppercase tracking-wide text-ink2">
              Credit issued per person
            </h2>
            <p className="mb-3 text-xs text-ink3">
              There is no aggregate cap anywhere — admin_issue_credit caps a single call at 5,000
              EGP and nothing counts the calls. This is the read that makes an unusual day visible.
            </p>
            <ul className="flex flex-wrap gap-2 text-sm">
              {totals.creditByActor.map(([who, amount]) => (
                <li key={who} className="rounded-full border border-line px-3 py-1">
                  <span className="font-semibold">{who}</span> · {money(amount)}
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* Say what is NOT here. An audit screen that looks complete when it is
            not is the failure mode worth designing against. */}
        <section className="rounded-2xl border border-dashed border-line bg-white p-4 text-xs text-ink3">
          <strong className="text-ink2">Not recorded anywhere, so not shown:</strong> who marked a
          settlement paid (restaurant_settlements / driver_settlements store paid_at and a bank
          reference, but no actor), and every commission-rate change
          (admin_set_commission writes restaurants.commission_pct with no log at all). Both need a
          database change to become auditable.
        </section>

        {truncated && (
          <p className="text-xs text-amber-700">
            One or more sources hit the {ROW_LIMIT}-row limit for this window — narrow the range to
            be sure you are seeing everything.
          </p>
        )}

        {entries.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-line bg-white p-10 text-center text-ink3">
            Nothing paid out in this window.
          </div>
        ) : (
          <div className="overflow-hidden rounded-2xl border border-line bg-white">
            <table className="w-full text-sm">
              <thead className="border-b border-line bg-bg text-left text-xs uppercase text-ink3">
                <tr>
                  <th className="px-4 py-3">When</th>
                  <th className="px-4 py-3">What</th>
                  <th className="px-4 py-3">To</th>
                  <th className="px-4 py-3 text-right">Amount</th>
                  <th className="px-4 py-3">By</th>
                  <th className="px-4 py-3">Detail</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((e) => (
                  <tr key={e.id} className="border-b border-line last:border-0">
                    <td className="px-4 py-3 text-xs text-ink3">
                      {new Date(e.at).toLocaleString('en-US')}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`rounded-full border px-2 py-0.5 text-xs ${KIND_CLASS[e.kind]}`}>
                        {KIND_LABEL[e.kind]}
                      </span>
                    </td>
                    <td className="px-4 py-3 font-semibold">{e.subject}</td>
                    <td
                      className={
                        'px-4 py-3 text-right font-bold ' + (e.amountEgp < 0 ? 'text-ink3' : '')
                      }
                    >
                      {money(e.amountEgp)}
                    </td>
                    <td className="px-4 py-3">{e.actor ?? <span className="text-ink3">not recorded</span>}</td>
                    <td className="px-4 py-3 text-xs text-ink3">{e.detail}</td>
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
