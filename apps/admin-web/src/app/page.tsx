'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';
import type { OpsDriver, OpsOrder } from '@/lib/types';
import { DispatchBoard } from './DispatchBoard';
import { DEFAULT_MAX_PING_AGE_SECONDS } from '@/lib/dispatch';
import { SignOutButton } from './SignOutButton';
import { Skeleton, DispatchBoardSkeleton } from './Skeleton';
import { LegalLinks } from './LegalLinks';

type Phase =
  | { state: 'loading' }
  | { state: 'unauthorized' }
  | {
      state: 'ready';
      displayName: string;
      orders: OpsOrder[];
      drivers: OpsDriver[];
      maxPingAgeSeconds: number;
    };

/**
 * Ops dispatch dashboard root — pure client-side (static export, no server).
 *
 * Auth + role gate run in the browser: no session → /login; non-admin/dispatcher
 * → unauthorized. Then loads the active orders + drivers; DispatchBoard keeps
 * them live via Realtime. (Was an SSR server component + middleware guard.)
 */
export default function OpsPage() {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>({ state: 'loading' });

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

      // Gate: only admin / dispatcher.
      const { data: me } = await supabase
        .from('users')
        .select('role, display_name')
        .eq('id', session.user.id)
        .single();
      const role = me?.role as string | undefined;
      if (role !== 'admin' && role !== 'dispatcher') {
        if (!cancelled) setPhase({ state: 'unauthorized' });
        return;
      }

      // Active orders + drivers (admin RLS = broad read), plus the dispatch
      // freshness window so this board applies the SAME rule nearest_drivers
      // does (migration 201) instead of a second hardcoded copy that can drift.
      const [{ data: orders }, { data: drivers }, { data: pingSetting }] = await Promise.all([
        supabase
          .from('orders')
          .select(
            'id, short_code, restaurant_id, restaurant_name, status, payment_method, payment_status, fulfillment_type, total_egp, delivery_fee_egp, assigned_driver_id, zone, address_snapshot, placed_at, eta_at',
          )
          .not('status', 'in', '(delivered,cancelled,rejected)')
          .order('placed_at', { ascending: true }),
        supabase
          .from('drivers')
          .select(
            'id, name, phone, vehicle, status, is_verified, is_active, rating, home_zone, last_ping_at',
          )
          .eq('is_active', true)
          .order('status', { ascending: true }),
        // maybeSingle, not single: a missing row or a missing grant must degrade
        // to the documented default, never blank the whole dashboard.
        supabase
          .from('platform_settings')
          .select('value')
          .eq('key', 'dispatch_max_ping_age_seconds')
          .maybeSingle(),
      ]);

      if (cancelled) return;
      setPhase({
        state: 'ready',
        displayName: me?.display_name ?? role,
        orders: (orders as OpsOrder[]) ?? [],
        drivers: (drivers as OpsDriver[]) ?? [],
        maxPingAgeSeconds:
          typeof pingSetting?.value === 'number' && pingSetting.value > 0
            ? pingSetting.value
            : DEFAULT_MAX_PING_AGE_SECONDS,
      });
    })();

    return () => {
      cancelled = true;
    };
  }, [router]);

  if (phase.state === 'loading') {
    return (
      <main className="min-h-screen bg-bg">
        <header className="flex items-center justify-between border-b border-line bg-white px-6 py-4">
          <Skeleton className="h-5 w-32" />
        </header>
        <DispatchBoardSkeleton />
      </main>
    );
  }

  if (phase.state === 'unauthorized') {
    return (
      <main className="flex min-h-screen items-center justify-center bg-bg px-4 text-center">
        <div className="max-w-md">
          <h1 className="text-xl font-bold">Not authorized</h1>
          <p className="mt-2 text-ink2">This dashboard is for Sharm Eats operations staff only.</p>
          <div className="mt-6">
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
            Dispatch
          </div>
          <div className="text-xs text-ink3">Dispatch board · {phase.displayName}</div>
        </div>
      </header>

      <DispatchBoard
        initialOrders={phase.orders}
        initialDrivers={phase.drivers}
        maxPingAgeSeconds={phase.maxPingAgeSeconds}
      />

      <footer className="border-t border-line px-6 py-6">
        <LegalLinks />
      </footer>
    </main>
  );
}
