import { redirect } from 'next/navigation';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import type { OpsDriver, OpsOrder } from '@/lib/types';
import { DispatchBoard } from './DispatchBoard';
import { SignOutButton } from './SignOutButton';

export const dynamic = 'force-dynamic';

export default async function OpsPage() {
  const supabase = await createSupabaseServerClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  // Gate: only admin / dispatcher.
  const { data: me } = await supabase.from('users').select('role, display_name').eq('id', user.id).single();
  const role = me?.role as string | undefined;
  if (role !== 'admin' && role !== 'dispatcher') {
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
      .select('id, name, phone, vehicle, status, is_verified, is_active, rating, home_zone, last_ping_at')
      .eq('is_active', true)
      .order('status', { ascending: true }),
  ]);

  return (
    <main className="min-h-screen bg-bg">
      <header className="sticky top-0 z-10 flex items-center justify-between border-b border-line bg-white/90 px-6 py-4 backdrop-blur">
        <div>
          <div className="text-lg font-extrabold">
            Sharm Eats <span className="text-accent">Ops</span>
          </div>
          <div className="text-xs text-ink3">Dispatch board · {me?.display_name ?? role}</div>
        </div>
        <SignOutButton />
      </header>

      <DispatchBoard
        initialOrders={(orders as OpsOrder[]) ?? []}
        initialDrivers={(drivers as OpsDriver[]) ?? []}
      />
    </main>
  );
}
