'use client';

import Link from "next/link";
import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';
import { SignOutButton } from '../SignOutButton';
import { useToast } from '../Toast';
import { Skeleton } from '../Skeleton';

type Phase =
  | { state: 'loading' }
  | { state: 'unauthorized' }
  | { state: 'ready'; displayName: string };

interface Scorecard {
  restaurant_id: string;
  restaurant_name: string;
  orders: number;
  acceptance_rate: number | null;
  reject_rate: number | null;
  cancel_rate: number | null;
  on_time_rate: number | null;
  avg_prep_minutes: number | null;
  avg_food_rating: number | null;
}

const pct = (v: number | null) => (v == null ? '—' : `${Math.round(v * 100)}%`);
const num = (v: number | null, suffix = '') => (v == null ? '—' : `${v}${suffix}`);

// A rate is "bad" if it crosses a concern threshold — highlight in red.
const bad = (v: number | null, threshold: number) => v != null && v >= threshold;
const lowRating = (v: number | null) => v != null && v < 4;

export default function ScorecardsPage() {
  const router = useRouter();
  const { toast } = useToast();
  const [phase, setPhase] = useState<Phase>({ state: 'loading' });
  const [days, setDays] = useState(30);
  const [rows, setRows] = useState<Scorecard[]>([]);

  const load = useCallback(async () => {
    const supabase = createSupabaseBrowserClient();
    const { data, error } = await supabase.rpc('all_restaurant_scorecards', { p_days: days });
    if (error) {
      toast(error.message, 'error');
      return;
    }
    setRows((data as Scorecard[]) ?? []);
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
      const { data: me } = await supabase.from('users').select('role, display_name').eq('id', session.user.id).single();
      if ((me?.role as string | undefined) !== 'admin') {
        if (!cancelled) setPhase({ state: 'unauthorized' });
        return;
      }
      await load();
      if (!cancelled) setPhase({ state: 'ready', displayName: me?.display_name ?? 'Admin' });
    })();
    return () => {
      cancelled = true;
    };
  }, [router, load]);

  if (phase.state === 'loading') {
    return (
      <main className="min-h-screen bg-bg">
        <header className="flex items-center justify-between border-b border-line bg-white px-6 py-4">
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-8 w-20" />
        </header>
        <div className="mx-auto max-w-5xl space-y-3 p-6">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full" />
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
          <p className="mt-2 text-ink2">Restaurant scorecards require an admin account.</p>
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
          <div className="text-lg font-extrabold">
            Sharm Eats <span className="text-accent">Scorecards</span>
          </div>
          <div className="text-xs text-ink3">Restaurant performance · {phase.displayName}</div>
        </div>
        <div className="flex items-center gap-3">
          <Link
            href="/"
            className="rounded-lg border border-line px-3.5 py-2 text-sm font-semibold hover:border-accent hover:text-accent"
          >
            Dispatch
          </Link>
          <SignOutButton />
        </div>
      </header>

      <div className="mx-auto max-w-5xl space-y-4 p-6">
        <div className="flex items-center gap-2">
          {[7, 30, 90].map((d) => (
            <button
              key={d}
              onClick={() => setDays(d)}
              className={`rounded-lg px-3.5 py-2 text-sm font-semibold ${
                days === d ? 'bg-accent text-white' : 'border border-line'
              }`}
            >
              {d} days
            </button>
          ))}
          <span className="ml-2 text-xs text-ink3">Sorted worst-first (lowest rating, then reject rate).</span>
        </div>

        {rows.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-line bg-white p-10 text-center text-ink3">
            No orders in this window yet.
          </div>
        ) : (
          <div className="overflow-x-auto rounded-2xl border border-line bg-white">
            <table className="w-full text-sm">
              <thead className="border-b border-line bg-bg text-left text-xs uppercase text-ink3">
                <tr>
                  <th className="px-4 py-3">Restaurant</th>
                  <th className="px-4 py-3 text-right">Orders</th>
                  <th className="px-4 py-3 text-right">Accept</th>
                  <th className="px-4 py-3 text-right">Reject</th>
                  <th className="px-4 py-3 text-right">Cancel</th>
                  <th className="px-4 py-3 text-right">On-time</th>
                  <th className="px-4 py-3 text-right">Prep</th>
                  <th className="px-4 py-3 text-right">Rating</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.restaurant_id} className="border-b border-line last:border-0">
                    <td className="px-4 py-3 font-semibold">{r.restaurant_name}</td>
                    <td className="px-4 py-3 text-right">{r.orders}</td>
                    <td className="px-4 py-3 text-right">{pct(r.acceptance_rate)}</td>
                    <td className={`px-4 py-3 text-right ${bad(r.reject_rate, 0.1) ? 'font-bold text-red-600' : ''}`}>
                      {pct(r.reject_rate)}
                    </td>
                    <td className={`px-4 py-3 text-right ${bad(r.cancel_rate, 0.1) ? 'font-bold text-red-600' : ''}`}>
                      {pct(r.cancel_rate)}
                    </td>
                    <td className={`px-4 py-3 text-right ${r.on_time_rate != null && r.on_time_rate < 0.8 ? 'text-amber-600' : ''}`}>
                      {pct(r.on_time_rate)}
                    </td>
                    <td className="px-4 py-3 text-right">{num(r.avg_prep_minutes, 'm')}</td>
                    <td className={`px-4 py-3 text-right ${lowRating(r.avg_food_rating) ? 'font-bold text-red-600' : ''}`}>
                      {num(r.avg_food_rating, '★')}
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
