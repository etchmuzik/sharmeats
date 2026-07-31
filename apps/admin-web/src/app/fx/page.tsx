'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';
import { captureError } from '@/lib/sentry';
import {
  EXPIRING_SOON_HOURS,
  QUOTE_CURRENCIES,
  STALE_HOURS_DEFAULT,
  describeFxError,
  expiryLabel,
  fxHealth,
  isMissingFunction,
  jumpPct,
  validateFxForm,
  type FxHealth,
  type FxRateRow,
} from '@/lib/fx';
import { SignOutButton } from '../SignOutButton';
import { useToast } from '../Toast';
import { Skeleton } from '../Skeleton';

/**
 * Display-FX operator surface — the missing half of migration 182.
 *
 * The database has had a proper FX home since mig 182: immutable observations,
 * one active rate per currency, a jump guard, a nightly health sweep, and
 * exactly one human writer — admin_set_fx_rate. Nothing in the product could
 * call it. The four seeded rates are the Phase-0 planning numbers with a 7-day
 * shelf life; once they expire the customer app must label every conversion
 * approximate or fall back to EGP-only, and the nightly alert tells an operator
 * to run an RPC they have no way to run.
 *
 * READ is current_fx_rates() — the same call the customer app makes, so what an
 * operator sees here is exactly what a tourist sees converted. WRITE is
 * admin_set_fx_rate and nothing else: the page never touches public.fx_rates
 * directly, so the bounds, the jump guard and the audit stamp all apply.
 */

type Phase =
  | { state: 'loading' }
  | { state: 'unauthorized' }
  | { state: 'ready'; displayName: string };

const HEALTH_LABEL: Record<FxHealth, string> = {
  live: 'Live',
  expiring: 'Expiring soon',
  stale: 'Stale — shown as approximate',
  missing: 'No rate',
};

const HEALTH_CLASS: Record<FxHealth, string> = {
  live: 'border-green-500 text-green-700',
  expiring: 'border-amber-500 text-amber-700',
  stale: 'border-red-500 text-red-700',
  missing: 'border-red-500 text-red-700',
};

/** Shelf-life presets, in hours. A manual rate should not outlive its reason. */
const SHELF_LIVES = [
  { hours: 24, label: '1 day' },
  { hours: 72, label: '3 days' },
  { hours: STALE_HOURS_DEFAULT, label: '7 days' },
  { hours: 336, label: '14 days' },
  { hours: 720, label: '30 days' },
] as const;

export default function FxRatesPage() {
  const router = useRouter();
  const { toast } = useToast();
  const [phase, setPhase] = useState<Phase>({ state: 'loading' });
  const [rows, setRows] = useState<FxRateRow[]>([]);
  const [notApplied, setNotApplied] = useState(false);

  // Override form. `allowJump` is deliberately NOT sticky: it is re-armed per
  // submission, so an operator cannot leave the guard switched off.
  const [quote, setQuote] = useState<string>(QUOTE_CURRENCIES[0]);
  const [rate, setRate] = useState('');
  const [reason, setReason] = useState('');
  const [staleHours, setStaleHours] = useState(String(STALE_HOURS_DEFAULT));
  const [allowJump, setAllowJump] = useState(false);
  const [busy, setBusy] = useState(false);

  const loadRates = useCallback(async () => {
    const supabase = createSupabaseBrowserClient();
    const { data, error } = await supabase.rpc('current_fx_rates');
    if (error) {
      // Deploy order: the web surface ships independently of the database, so
      // "function not found" is a fact to explain rather than an error.
      if (isMissingFunction(error)) {
        setNotApplied(true);
        return;
      }
      captureError(error, { surface: 'admin-web', screen: 'fx', action: 'current_fx_rates' });
      toast(`Could not read FX rates: ${error.message}`, 'error');
      return;
    }
    setNotApplied(false);
    setRows(((data ?? []) as FxRateRow[]).slice().sort((a, b) => a.quote_currency.localeCompare(b.quote_currency)));
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
      const { data: me } = await supabase
        .from('users')
        .select('role, display_name')
        .eq('id', session.user.id)
        .single();
      if ((me?.role as string | undefined) !== 'admin') {
        if (!cancelled) setPhase({ state: 'unauthorized' });
        return;
      }
      await loadRates();
      if (!cancelled) setPhase({ state: 'ready', displayName: me?.display_name ?? 'Admin' });
    })();
    return () => {
      cancelled = true;
    };
  }, [router, loadRates]);

  const liveRate = (currency: string): FxRateRow | undefined =>
    rows.find((r) => r.quote_currency === currency);

  /** Prefill the form from a row so "Update" is one click plus a reason. */
  const editCurrency = (currency: string) => {
    const current = liveRate(currency);
    setQuote(currency);
    setRate(current ? String(current.rate) : '');
    setReason('');
    setStaleHours(String(STALE_HOURS_DEFAULT));
    setAllowJump(false);
  };

  const submit = async () => {
    const validation = validateFxForm({ quote, rate, reason, staleHours });
    if (!validation.ok) {
      toast(validation.error, 'error');
      return;
    }
    const { values } = validation;
    const previous = liveRate(values.quote);
    const move = jumpPct(previous?.rate, values.rate);

    if (
      !window.confirm(
        `Set ${values.quote} to ${values.rate} EGP per 1 ${values.quote}?\n\n` +
          (previous ? `Live now: ${previous.rate} (${previous.source})` : 'No live rate for this currency yet.') +
          (move !== null ? `\nMove: ${move.toFixed(1)}%` : '') +
          `\nExpires: ${values.staleHours}h from now\n\n` +
          'Every customer conversion uses this until it expires. Charging stays in EGP.',
      )
    ) {
      return;
    }

    setBusy(true);
    try {
      const supabase = createSupabaseBrowserClient();
      const { error } = await supabase.rpc('admin_set_fx_rate', {
        p_quote: values.quote,
        p_rate: values.rate,
        p_reason: values.reason,
        p_stale_hours: values.staleHours,
        p_allow_jump: allowJump,
      });
      if (error) throw error;
      toast(`${values.quote} is now ${values.rate} EGP per unit`, 'success');
      setRate('');
      setReason('');
      setAllowJump(false);
      await loadRates();
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      // Not Sentry-worthy on its own: a jump rejection is the database asking
      // for a second decision, not a failure. Everything else is reported with
      // enough context to identify the currency and the attempted rate.
      if (!message.includes('RATE_JUMP_REJECTED')) {
        captureError(e, {
          surface: 'admin-web',
          screen: 'fx',
          action: 'admin_set_fx_rate',
          quote: values.quote,
          rate: values.rate,
          staleHours: values.staleHours,
          allowJump,
        });
      }
      toast(describeFxError(message), 'error');
      if (message.includes('RATE_JUMP_REJECTED')) setAllowJump(false);
    } finally {
      setBusy(false);
    }
  };

  if (phase.state === 'loading') {
    return (
      <main className="min-h-screen bg-bg">
        <header className="flex items-center justify-between border-b border-line bg-white px-6 py-4">
          <Skeleton className="h-5 w-40" />
        </header>
        <div className="mx-auto max-w-4xl space-y-3 p-6">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-20 w-full" />
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
          <p className="mt-2 text-ink2">Setting display FX rates requires an admin account.</p>
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

  const needsAttention = QUOTE_CURRENCIES.filter((c) => {
    const health = fxHealth(liveRate(c));
    return health === 'stale' || health === 'missing' || health === 'expiring';
  });

  return (
    <main className="min-h-screen bg-bg">
      <header className="sticky top-0 z-10 flex items-center justify-between border-b border-line bg-white/90 px-6 py-4 backdrop-blur">
        <div>
          <div className="text-lg font-extrabold">FX rates</div>
          <div className="text-xs text-ink3">Display conversion · {phase.displayName}</div>
        </div>
      </header>

      <div className="mx-auto max-w-4xl space-y-6 p-6">
        <p className="text-sm text-ink2">
          Every order is priced, charged and settled in <strong>EGP</strong>. These rates only
          convert the displayed total for a customer browsing in their own currency, so a wrong
          rate misleads rather than mischarges — and a stale one makes the app label conversions
          approximate or drop back to EGP-only. Rates are EGP per 1 unit of the currency.
        </p>

        {notApplied ? (
          <div className="rounded-2xl border border-amber-500 bg-white p-5 text-sm">
            <p className="font-bold text-amber-700">FX rates are not in this database yet.</p>
            <p className="mt-1 text-ink2">
              Migration 182 has not been applied to the project this dashboard points at. Apply it,
              then reload — nothing on this page works until then.
            </p>
          </div>
        ) : (
          <>
            {needsAttention.length > 0 && (
              <div className="rounded-2xl border border-amber-500 bg-white p-4 text-sm">
                <span className="font-bold text-amber-700">
                  {needsAttention.length} currency(ies) need attention:
                </span>{' '}
                <span className="text-ink2">
                  {needsAttention.join(', ')}. A rate within {EXPIRING_SOON_HOURS}h of expiry is
                  flagged early so it never lapses unnoticed.
                </span>
              </div>
            )}

            <div className="overflow-hidden rounded-2xl border border-line bg-white">
              <table className="w-full text-sm">
                <thead className="border-b border-line bg-bg text-left text-xs uppercase text-ink3">
                  <tr>
                    <th className="px-4 py-3">Currency</th>
                    <th className="px-4 py-3 text-right">EGP per unit</th>
                    <th className="px-4 py-3">Source</th>
                    <th className="px-4 py-3">Expires</th>
                    <th className="px-4 py-3">Health</th>
                    <th className="px-4 py-3 text-right">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {QUOTE_CURRENCIES.map((currency) => {
                    const row = liveRate(currency);
                    const health = fxHealth(row);
                    return (
                      <tr key={currency} className="border-b border-line last:border-0">
                        <td className="px-4 py-3 font-bold">{currency}</td>
                        <td className="px-4 py-3 text-right font-bold">{row ? row.rate : '—'}</td>
                        <td className="px-4 py-3 text-xs text-ink3">{row?.source ?? '—'}</td>
                        <td className="px-4 py-3 text-xs text-ink3">
                          {row ? (
                            <>
                              {new Date(row.stale_after).toLocaleString('en-US')}
                              <span className="ml-1">({expiryLabel(row.stale_after)})</span>
                            </>
                          ) : (
                            '—'
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className={`rounded-full border px-2 py-0.5 text-xs ${HEALTH_CLASS[health]}`}
                          >
                            {HEALTH_LABEL[health]}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <button
                            onClick={() => editCurrency(currency)}
                            className="rounded-lg border border-line px-3 py-1.5 text-xs font-semibold hover:border-accent hover:text-accent"
                          >
                            {row ? 'Update' : 'Set rate'}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* The override form. admin_set_fx_rate is the only writer that
                exists, and the reason it demands is stored on the immutable
                observation row alongside the actor — the row IS the audit. */}
            <section className="rounded-2xl border border-line bg-white p-5">
              <div className="mb-3 flex items-baseline justify-between">
                <h2 className="text-sm font-bold uppercase tracking-wide text-ink2">Set a rate</h2>
                <span className="text-xs text-ink3">
                  recorded against your account, with the reason, forever
                </span>
              </div>
              <div className="flex flex-wrap items-end gap-3">
                <label className="text-sm font-semibold">
                  <span className="mb-1 block text-ink2">Currency</span>
                  <select
                    value={quote}
                    onChange={(e) => setQuote(e.target.value)}
                    className="rounded-lg border border-line px-3 py-2"
                  >
                    {QUOTE_CURRENCIES.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-sm font-semibold">
                  <span className="mb-1 block text-ink2">EGP per 1 {quote}</span>
                  <input
                    type="number"
                    inputMode="decimal"
                    step="0.000001"
                    value={rate}
                    onChange={(e) => setRate(e.target.value)}
                    placeholder="52.85"
                    className="w-32 rounded-lg border border-line px-3 py-2"
                  />
                </label>
                <label className="text-sm font-semibold">
                  <span className="mb-1 block text-ink2">Shelf life</span>
                  <select
                    value={staleHours}
                    onChange={(e) => setStaleHours(e.target.value)}
                    className="rounded-lg border border-line px-3 py-2"
                  >
                    {SHELF_LIVES.map((s) => (
                      <option key={s.hours} value={String(s.hours)}>
                        {s.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="grow text-sm font-semibold">
                  <span className="mb-1 block text-ink2">Where this rate came from</span>
                  <input
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder="e.g. CBE mid-market, checked 10:00"
                    className="w-full rounded-lg border border-line px-3 py-2"
                  />
                </label>
                <button
                  onClick={submit}
                  disabled={busy}
                  className="rounded-lg bg-accent px-4 py-2.5 text-sm font-bold text-white disabled:opacity-50"
                >
                  {busy ? 'Setting…' : 'Set rate'}
                </button>
              </div>

              <label className="mt-3 flex items-center gap-2 text-sm text-ink2">
                <input
                  type="checkbox"
                  checked={allowJump}
                  onChange={(e) => setAllowJump(e.target.checked)}
                />
                This jump is intended — allow a move of more than 10% (ops is alerted either way)
              </label>
            </section>
          </>
        )}
      </div>
    </main>
  );
}
