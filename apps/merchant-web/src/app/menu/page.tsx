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
  | { state: 'ready'; restaurantId: string; name: string };

export default function MerchantMenuPage() {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>({ state: 'loading' });

  useEffect(() => {
    const supabase = createSupabaseBrowserClient();
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { router.replace('/login'); return; }
      const { data } = await supabase
        .from('merchant_staff')
        .select('restaurant_id, restaurants(name, is_open, onboarding_status, onboarding_rejection_reason)')
        .limit(1);
      const staff = data?.[0] as unknown as StaffOnboardingRow | undefined;
      if (!staff || resolveOnboardingPhase(staff) !== 'active') {
        setPhase({ state: 'blocked' });
        return;
      }
      setPhase({ state: 'ready', restaurantId: staff.restaurant_id, name: staff.restaurants.name });
    })();
  }, [router]);

  if (phase.state === 'loading') return <Skeleton />;
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
