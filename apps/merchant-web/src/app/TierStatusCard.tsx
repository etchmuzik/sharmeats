'use client';

import { useEffect, useState } from 'react';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';

interface TierStatus {
  tier: 'bronze' | 'silver' | 'gold';
  ordersRolling90d: number;
  commissionPct: number;
  featured: boolean;
}

type Phase = { state: 'loading' } | { state: 'ready'; status: TierStatus } | { state: 'error' };

const TIER_LABEL: Record<TierStatus['tier'], string> = { bronze: 'Bronze', silver: 'Silver', gold: 'Gold' };
// Verified against supabase/migrations/042_loyalty_ledger.sql platform_settings
// seed rows: loyalty_restaurant_silver_threshold = 50, loyalty_restaurant_gold_threshold = 200
// (rolling-90d delivered order counts).
const NEXT_THRESHOLD: Record<TierStatus['tier'], number | null> = { bronze: 50, silver: 200, gold: null };

/**
 * Self-fetching tier status widget for the merchant dashboard, following the
 * merchant-web convention (see OrderCard.tsx) of ad-hoc Tailwind cards — no
 * shared Card component exists in this app.
 *
 * Fetches via the my_restaurant_tier() RPC (046_loyalty_rpcs.sql), which
 * resolves the caller's restaurant from merchant_staff/auth.uid() server-side,
 * so this component takes no props.
 */
export function TierStatusCard() {
  const [phase, setPhase] = useState<Phase>({ state: 'loading' });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const supabase = createSupabaseBrowserClient();
      const { data, error } = await supabase.rpc('my_restaurant_tier');
      if (cancelled) return;
      if (error || !data || (Array.isArray(data) && data.length === 0)) {
        setPhase({ state: 'error' });
        return;
      }
      const row = Array.isArray(data) ? data[0] : data;
      setPhase({
        state: 'ready',
        status: {
          tier: row.tier,
          ordersRolling90d: row.orders_rolling_90d,
          commissionPct: row.commission_pct,
          featured: row.featured,
        },
      });
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (phase.state === 'loading') {
    return <div className="rounded-2xl border border-line bg-white p-4 shadow-sm">Loading tier…</div>;
  }
  if (phase.state === 'error') {
    return null; // non-critical widget; fail silently rather than block the order queue
  }

  const { status } = phase;
  const nextThreshold = NEXT_THRESHOLD[status.tier];
  const ordersToNext = nextThreshold ? Math.max(0, nextThreshold - status.ordersRolling90d) : 0;

  return (
    <div className="rounded-2xl border border-line bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold text-ink">{TIER_LABEL[status.tier]} tier</span>
        {status.featured && (
          <span className="rounded-full bg-accent/10 px-3 py-1 text-xs font-semibold text-accent">Featured</span>
        )}
      </div>
      <p className="mt-2 text-xs text-ink2">
        {status.ordersRolling90d} orders (90d) · commission {status.commissionPct.toFixed(1)}%
      </p>
      {nextThreshold && (
        <p className="mt-1 text-xs text-ink3">{ordersToNext} more orders to next tier</p>
      )}
    </div>
  );
}
