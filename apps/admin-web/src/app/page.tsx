'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';
import type { OpsDriver, OpsOrder } from '@/lib/types';
import { DispatchBoard } from './DispatchBoard';
import { SignOutButton } from './SignOutButton';
import { Skeleton, DispatchBoardSkeleton } from './Skeleton';

type Phase =
  | { state: 'loading' }
  | { state: 'unauthorized' }
  | { state: 'ready'; displayName: string; orders: OpsOrder[]; drivers: OpsDriver[] };

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

      // Active orders + drivers (admin RLS = broad read).
      const [{ data: orders }, { data: drivers }] = await Promise.all([
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
      ]);

      if (cancelled) return;
      setPhase({
        state: 'ready',
        displayName: me?.display_name ?? role,
        orders: (orders as OpsOrder[]) ?? [],
        drivers: (drivers as OpsDriver[]) ?? [],
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
          <Skeleton className="h-8 w-20" />
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
            Sharm Eats <span className="text-accent">Ops</span>
          </div>
          <div className="text-xs text-ink3">Dispatch board · {phase.displayName}</div>
        </div>
        <div className="flex items-center gap-3">
          <a
            href="/menu"
            className="rounded-lg border border-line px-3.5 py-2 text-sm font-semibold hover:border-accent hover:text-accent"
          >
            Menus
          </a>
          <a
            href="/finance"
            className="rounded-lg border border-line px-3.5 py-2 text-sm font-semibold hover:border-accent hover:text-accent"
          >
            Finance
          </a>
          <a
            href="/kyc"
            className="rounded-lg border border-line px-3.5 py-2 text-sm font-semibold hover:border-accent hover:text-accent"
          >
            KYC
          </a>
          <SignOutButton />
        </div>
      </header>

      <DispatchBoard initialOrders={phase.orders} initialDrivers={phase.drivers} />
    </main>
  );
}
