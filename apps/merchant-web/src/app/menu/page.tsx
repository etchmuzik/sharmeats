'use client';

/**
 * Own-restaurant menu editor. The RLS merchant policies on menu_sections/
 * menu_items/modifiers/modifier_options are the real guard — this page just
 * resolves WHICH restaurant and renders the same MenuManager admin uses.
 */
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';
import { resolveOnboardingPhase, type StaffOnboardingRow } from '@/lib/onboarding';
import { MenuManager } from './MenuManager';
import { Skeleton } from '../Skeleton';

type Phase =
  | { state: 'loading' }
  | { state: 'blocked' }
  | { state: 'error' } // [M2] transient fetch failure — retry, not "not approved"
  | { state: 'ready'; restaurantId: string; name: string };

export default function MerchantMenuPage() {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>({ state: 'loading' });
  const [reloadKey, setReloadKey] = useState(0); // [M2] bump to retry the load

  useEffect(() => {
    const supabase = createSupabaseBrowserClient();
    let cancelled = false;
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { router.replace('/login'); return; }
      const { data, error } = await supabase
        .from('merchant_staff')
        .select('restaurant_id, restaurants(name, is_open, onboarding_status, onboarding_rejection_reason)')
        .limit(1);

      if (cancelled) return;
      // [M2] A query failure is NOT the same as "not approved yet". Previously
      // the error was discarded and staff was undefined → an approved merchant
      // saw the "unlocks once approved" blocked screen on any network blip.
      if (error) {
        setPhase({ state: 'error' });
        return;
      }

      const staff = data?.[0] as unknown as StaffOnboardingRow | undefined;
      if (!staff || resolveOnboardingPhase(staff) !== 'active') {
        setPhase({ state: 'blocked' });
        return;
      }
      setPhase({ state: 'ready', restaurantId: staff.restaurant_id, name: staff.restaurants.name });
    })();
    return () => {
      cancelled = true;
    };
  }, [router, reloadKey]);

  if (phase.state === 'loading') return <Skeleton />;
  if (phase.state === 'error') {
    return (
      <main className="mx-auto max-w-lg p-6 text-center">
        <h1 className="text-lg font-bold">Couldn&apos;t load the menu</h1>
        <p className="mt-2 text-sm text-ink2">Check your connection and try again.</p>
        <div className="mt-4 flex flex-col items-center gap-3">
          <button
            onClick={() => {
              setPhase({ state: 'loading' });
              setReloadKey((k) => k + 1);
            }}
            className="rounded-lg bg-accent px-6 py-2 text-sm font-semibold text-white"
          >
            Retry
          </button>
          <Link className="underline" href="/">Back to dashboard</Link>
        </div>
      </main>
    );
  }
  if (phase.state === 'blocked') {
    return (
      <main className="mx-auto max-w-lg p-6">
        <p className="text-sm">Menu editing unlocks once your restaurant is approved.</p>
        <Link className="underline" href="/">Back to dashboard</Link>
      </main>
    );
  }
  return (
    <main className="mx-auto max-w-3xl p-6">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-2xl font-extrabold">{phase.name} — Menu</h1>
        <Link className="underline" href="/">Dashboard</Link>
      </div>
      <MenuManager restaurantId={phase.restaurantId} />
    </main>
  );
}
