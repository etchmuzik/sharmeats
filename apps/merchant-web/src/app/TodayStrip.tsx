'use client';

import { useEffect, useState } from 'react';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';

/**
 * UTC instant of today's midnight in Africa/Cairo — the delivery market's day,
 * regardless of the device's timezone. Uses the current Cairo offset (Egypt
 * observes DST, so it isn't a constant +02:00); the only skew is the few hours
 * around a DST switch, which is fine for a dashboard stat.
 */
function cairoDayStartIso(): string {
  const now = new Date();
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo' }).format(now); // YYYY-MM-DD
  const offset =
    new Intl.DateTimeFormat('en-US', { timeZone: 'Africa/Cairo', timeZoneName: 'longOffset' })
      .formatToParts(now)
      .find((p) => p.type === 'timeZoneName')
      ?.value.replace('GMT', '') || '+02:00';
  return new Date(`${day}T00:00:00${offset}`).toISOString();
}

/**
 * Compact "how is today going" money strip above the order queue. Counts
 * DELIVERED orders since Cairo midnight and sums subtotal_egp — the
 * restaurant's food revenue. Deliberately NOT total_egp: that includes the
 * delivery fee, which drivers keep (docs/FINANCIALS.md), so it would overstate
 * what the kitchen earned. Reads the orders table directly like the queue's
 * initial load; RLS scopes staff to their own restaurant.
 */
export function TodayStrip({ restaurantId }: { restaurantId: string }) {
  const [today, setToday] = useState<{ count: number; foodEgp: number } | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const supabase = createSupabaseBrowserClient();
    let cancelled = false;

    const load = async () => {
      const { data, error } = await supabase
        .from('orders')
        .select('subtotal_egp')
        .eq('restaurant_id', restaurantId)
        .eq('status', 'delivered')
        .gte('delivered_at', cairoDayStartIso());
      if (cancelled) return;
      if (error) {
        setFailed(true);
        return;
      }
      const rows = (data as { subtotal_egp: number }[]) ?? [];
      setFailed(false);
      setToday({
        count: rows.length,
        foodEgp: rows.reduce((sum, r) => sum + (r.subtotal_egp ?? 0), 0),
      });
    };

    void load();
    // Refresh each minute so the strip tracks deliveries as they land (and the
    // window rolls over at Cairo midnight without a reload).
    const timer = setInterval(() => void load(), 60_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [restaurantId]);

  if (failed) {
    return null; // fail quiet — the dashboard's core is the order queue
  }
  if (!today) {
    return <div className="h-11 animate-pulse rounded-2xl border border-line bg-white" />;
  }

  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 rounded-2xl border border-line bg-white px-4 py-2.5 text-sm shadow-sm">
      <span className="font-bold uppercase tracking-wide text-ink2">Today</span>
      <span className="text-ink3">·</span>
      <span className="font-semibold">{today.count} delivered</span>
      <span className="text-ink3">·</span>
      <span>
        <span className="font-extrabold">EGP {today.foodEgp.toLocaleString('en-US')}</span>{' '}
        <span className="text-ink3">food sales</span>
      </span>
    </div>
  );
}
