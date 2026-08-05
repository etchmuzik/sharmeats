'use client';

import { hasErrorMarker } from '@/lib/displayError';

import { useEffect, useState } from 'react';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';

/**
 * The merchant's own performance scorecard.
 *
 * The RPC `restaurant_scorecard(restaurant_id, days)` has existed since
 * migration 077 and is already granted to `authenticated` with correct
 * internal authorization (077:43 — admin OR is_merchant_staff, fail-closed).
 * Until now its ONLY caller in the whole repo was the admin dashboard, using
 * the fleet-wide variant. Merchants were being scored and could not see it.
 * No new SQL was needed to fix that; this card is the missing half.
 *
 * Every rate can legitimately be NULL: 077 guards each denominator with
 * nullif(), so a restaurant with no delivered orders yet has no on-time rate
 * and no average prep time. That is the COMMON case at launch, not an edge
 * case — a brand-new merchant opens this card on day one. Nulls render as an
 * em-dash, never as "0%" (which would read as catastrophic performance) and
 * never as "NaN%".
 */

/** One row of restaurant_scorecard (077:21-35). Every metric is nullable. */
interface Scorecard {
  orders: number | null;
  delivered: number | null;
  acceptance_rate: number | null;
  reject_rate: number | null;
  cancel_rate: number | null;
  on_time_rate: number | null;
  avg_prep_minutes: number | null;
  avg_food_rating: number | null;
}

const WINDOW_DAYS = 30;

/** 0..1 numeric → "94%". Null/undefined → em-dash. */
function pct(value: number | null | undefined): string {
  return value === null || value === undefined ? '—' : `${Math.round(value * 100)}%`;
}

/** Nullable numeric → fixed-precision string, or em-dash. */
function num(value: number | null | undefined, digits: number, suffix = ''): string {
  return value === null || value === undefined ? '—' : `${value.toFixed(digits)}${suffix}`;
}

/**
 * Higher-is-better metrics turn amber below `warn`. Null is never coloured —
 * "no data yet" is not "bad".
 */
function toneUp(value: number | null | undefined, warn: number): string {
  if (value === null || value === undefined) return 'text-ink3';
  return value < warn ? 'text-red' : 'text-ink';
}

export function ScorecardCard({ restaurantId }: { restaurantId: string }) {
  const [card, setCard] = useState<Scorecard | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'hidden' | 'failed'>('loading');

  useEffect(() => {
    const supabase = createSupabaseBrowserClient();
    let cancelled = false;
    setCard(null);
    setState('loading');

    (async () => {
      const { data, error } = await supabase.rpc('restaurant_scorecard', {
        p_restaurant_id: restaurantId,
        p_days: WINDOW_DAYS,
      });
      if (cancelled) return;

      if (error) {
        // A de-linked staffer gets NOT_AUTHORIZED from 077:44 — that is not a
        // fault, they simply should not see the card. Anything else is a real
        // failure and is surfaced rather than swallowed.
        setCard(null);
        setState(hasErrorMarker(error, 'NOT_AUTHORIZED') ? 'hidden' : 'failed');
        return;
      }

      // A TABLE-returning plpgsql function arrives as an array. 077's final
      // SELECT is an ungrouped aggregate, so a restaurant with zero orders
      // still returns exactly ONE row whose metrics are all null — the array
      // is only empty if authorization short-circuited.
      const rows = (data as Scorecard[] | null) ?? [];
      const scorecard = rows[0] ?? null;
      setCard(scorecard);
      setState(scorecard ? 'ready' : 'hidden');
    })();

    return () => {
      cancelled = true;
    };
  }, [restaurantId]);

  if (state === 'hidden') return null;

  if (state === 'failed') {
    return (
      <div className="rounded-2xl border border-line bg-white p-4 shadow-sm">
        <div className="text-sm font-bold uppercase tracking-wide text-ink3">Your scorecard</div>
        <p className="mt-2 text-sm text-ink2">Couldn&apos;t load your scorecard just now.</p>
      </div>
    );
  }

  if (state === 'loading' || !card) {
    return <div className="h-40 animate-pulse rounded-2xl border border-line bg-white" />;
  }

  const orders = card.orders ?? 0;

  return (
    <div className="rounded-2xl border border-line bg-white p-4 shadow-sm">
      <div className="flex items-baseline justify-between">
        <h2 className="text-sm font-bold uppercase tracking-wide text-ink3">Your scorecard</h2>
        <span className="text-xs text-ink3">last {WINDOW_DAYS} days</span>
      </div>

      {orders === 0 ? (
        <p className="mt-3 text-sm text-ink2">
          No orders yet in this window. Your acceptance, on-time and rating figures appear here once
          orders start coming in.
        </p>
      ) : (
        <>
          <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
            <Metric label="Orders" value={String(orders)} />
            <Metric label="Delivered" value={String(card.delivered ?? 0)} />
            <Metric
              label="Accepted"
              value={pct(card.acceptance_rate)}
              tone={toneUp(card.acceptance_rate, 0.9)}
            />
            <Metric
              label="On time"
              value={pct(card.on_time_rate)}
              tone={toneUp(card.on_time_rate, 0.8)}
            />
            <Metric label="Avg prep" value={num(card.avg_prep_minutes, 0, ' min')} />
            <Metric
              label="Food rating"
              value={num(card.avg_food_rating, 1)}
              tone={toneUp(card.avg_food_rating, 4)}
            />
          </dl>
          <p className="mt-3 text-xs text-ink3">
            Acceptance and on-time rates feed your tier. A dash means there isn&apos;t enough data
            yet.
          </p>
        </>
      )}
    </div>
  );
}

function Metric({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div>
      <dt className="text-xs text-ink3">{label}</dt>
      <dd className={`text-lg font-extrabold tabular-nums ${tone ?? 'text-ink'}`}>{value}</dd>
    </div>
  );
}
