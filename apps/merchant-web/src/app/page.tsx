'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';
import type { MerchantContext, MerchantOrder } from '@/lib/types';
import { OrderQueue } from './OrderQueue';
import { SignOutButton } from './SignOutButton';
import { Skeleton, OrderQueueSkeleton } from './Skeleton';
import { TierStatusCard } from './TierStatusCard';
import { StatementsCard } from './StatementsCard';

type Phase =
  | { state: 'loading' }
  | { state: 'no-restaurant' }
  | { state: 'error' } // [H-BIZ1] transient fetch failure — retry, not "no restaurant"
  | { state: 'ready'; ctx: MerchantContext; initialOrders: MerchantOrder[] };

/**
 * Merchant dashboard root — pure client-side (static export, no server).
 *
 * Auth is enforced in the browser: no session → redirect to /login. We then
 * resolve the staffer's merchant (RLS-scoped) and load the initial active
 * queue; OrderQueue keeps it live via Realtime. (Previously this was an SSR
 * server component reading the session from cookies + a middleware guard.)
 */
export default function DashboardPage() {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>({ state: 'loading' });
  // Open/closed is toggleable from the header (RLS restaurants_merchant_update
  // already allows merchant staff to flip is_open). Held in local state so the
  // badge updates instantly; seeded from the resolved context once ready.
  const [isOpen, setIsOpen] = useState(false);
  const [togglingOpen, setTogglingOpen] = useState(false);
  const [reloadKey, setReloadKey] = useState(0); // [H-BIZ1] bump to retry the load

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

      // Resolve which merchant this staffer belongs to (RLS-scoped).
      const { data: staffRows, error: staffErr } = await supabase
        .from('merchant_staff')
        .select('restaurant_id, staff_role, restaurants(name, is_open)')
        .limit(1);

      if (cancelled) return;
      // [H-BIZ1] A query failure is NOT the same as "no restaurant linked".
      // Previously the error was discarded and staffRows was undefined → the
      // owner saw "not linked" mid-shift on any network blip. Show a retry.
      if (staffErr) {
        setPhase({ state: 'error' });
        return;
      }

      // Supabase types a to-one embed as an array; at runtime it's a single
      // object for merchant_staff→restaurants. Cast via unknown (pre-existing;
      // tsc flagged the direct cast — routed through unknown to satisfy it).
      const staff = staffRows?.[0] as unknown as
        | {
            restaurant_id: string;
            staff_role: string;
            restaurants: { name: string; is_open: boolean };
          }
        | undefined;

      if (!staff) {
        setPhase({ state: 'no-restaurant' });
        return;
      }

      const ctx: MerchantContext = {
        restaurantId: staff.restaurant_id,
        restaurantName: staff.restaurants?.name ?? 'Your restaurant',
        isOpen: staff.restaurants?.is_open ?? false,
        staffRole: staff.staff_role,
      };

      // Initial active queue (card orders show once paid; COD shows immediately).
      const { data: orders } = await supabase
        .from('orders')
        .select('*')
        .eq('restaurant_id', ctx.restaurantId)
        .not('status', 'in', '(delivered,cancelled,rejected)')
        .or('payment_method.eq.cash_on_delivery,payment_status.eq.paid')
        .order('placed_at', { ascending: true });

      if (cancelled) return;
      setIsOpen(ctx.isOpen);
      setPhase({ state: 'ready', ctx, initialOrders: (orders as MerchantOrder[]) ?? [] });
    })();

    return () => {
      cancelled = true;
    };
  }, [router, reloadKey]);

  if (phase.state === 'loading') {
    return (
      <main className="min-h-screen bg-bg">
        <header className="flex items-center justify-between border-b border-line bg-white px-6 py-4">
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-8 w-20" />
        </header>
        <OrderQueueSkeleton />
      </main>
    );
  }

  if (phase.state === 'error') {
    return (
      <main className="flex min-h-screen items-center justify-center bg-bg px-4 text-center">
        <div className="max-w-md">
          <h1 className="text-xl font-bold">Couldn&apos;t load the dashboard</h1>
          <p className="mt-2 text-ink2">Check your connection and try again.</p>
          <div className="mt-6 flex flex-col items-center gap-3">
            <button
              onClick={() => {
                setPhase({ state: 'loading' });
                setReloadKey((k) => k + 1);
              }}
              className="rounded-lg bg-accent px-6 py-2 font-semibold text-white"
            >
              Retry
            </button>
            <SignOutButton />
          </div>
        </div>
      </main>
    );
  }

  if (phase.state === 'no-restaurant') {
    return (
      <main className="flex min-h-screen items-center justify-center bg-bg px-4 text-center">
        <div className="max-w-md">
          <h1 className="text-xl font-bold">No restaurant linked</h1>
          <p className="mt-2 text-ink2">
            Your account is not yet linked to a restaurant. Ask the Sharm Eats team to add you as
            staff.
          </p>
          <div className="mt-6">
            <SignOutButton />
          </div>
        </div>
      </main>
    );
  }

  const { ctx, initialOrders } = phase;

  // Self-serve pause/resume intake. Lets an overwhelmed kitchen stop new orders
  // without phoning the platform. Optimistic with rollback on failure.
  const toggleOpen = async () => {
    if (togglingOpen) return;
    setTogglingOpen(true);
    const next = !isOpen;
    setIsOpen(next); // optimistic
    const supabase = createSupabaseBrowserClient();
    const { error } = await supabase
      .from('restaurants')
      .update({ is_open: next })
      .eq('id', ctx.restaurantId);
    if (error) {
      setIsOpen(!next); // rollback
      alert(`Could not update status: ${error.message}`);
    }
    setTogglingOpen(false);
  };

  return (
    <main className="min-h-screen bg-bg">
      <header className="sticky top-0 z-10 flex items-center justify-between border-b border-line bg-white/90 px-6 py-4 backdrop-blur">
        <div>
          <div className="text-lg font-extrabold">{ctx.restaurantName}</div>
          <div className="text-xs text-ink3">Merchant dashboard · {ctx.staffRole}</div>
        </div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={toggleOpen}
            disabled={togglingOpen}
            aria-pressed={isOpen}
            title={isOpen ? 'Tap to stop accepting new orders' : 'Tap to start accepting orders'}
            className={`rounded-full px-3 py-1 text-xs font-semibold transition disabled:opacity-60 ${
              isOpen ? 'bg-greensoft text-green hover:bg-green hover:text-white' : 'bg-redsoft text-red hover:bg-red hover:text-white'
            }`}
          >
            {togglingOpen ? '…' : isOpen ? 'Open · tap to pause' : 'Closed · tap to open'}
          </button>
          <SignOutButton />
        </div>
      </header>

      <div className="grid gap-4 px-6 pt-4 md:grid-cols-2">
        <TierStatusCard />
        <StatementsCard />
      </div>

      <OrderQueue context={ctx} initialOrders={initialOrders} />
    </main>
  );
}
