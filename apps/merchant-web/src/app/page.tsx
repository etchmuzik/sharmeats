import { redirect } from 'next/navigation';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import type { MerchantContext, MerchantOrder } from '@/lib/types';
import { OrderQueue } from './OrderQueue';
import { SignOutButton } from './SignOutButton';

// Always render fresh — this is a live ops surface.
export const dynamic = 'force-dynamic';

export default async function DashboardPage() {
  const supabase = await createSupabaseServerClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  // Resolve which merchant this staffer belongs to (RLS-scoped).
  const { data: staffRows } = await supabase
    .from('merchant_staff')
    .select('restaurant_id, staff_role, restaurants(name, is_open)')
    .limit(1);

  const staff = staffRows?.[0] as
    | { restaurant_id: string; staff_role: string; restaurants: { name: string; is_open: boolean } }
    | undefined;

  if (!staff) {
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

  const ctx: MerchantContext = {
    restaurantId: staff.restaurant_id,
    restaurantName: staff.restaurants?.name ?? 'Your restaurant',
    isOpen: staff.restaurants?.is_open ?? false,
    staffRole: staff.staff_role,
  };

  // Initial active queue (card orders only show once paid; COD shows immediately).
  const { data: orders } = await supabase
    .from('orders')
    .select('*')
    .eq('restaurant_id', ctx.restaurantId)
    .not('status', 'in', '(delivered,cancelled,rejected)')
    .or('payment_method.eq.cash_on_delivery,payment_status.eq.paid')
    .order('placed_at', { ascending: true });

  return (
    <main className="min-h-screen bg-bg">
      <header className="sticky top-0 z-10 flex items-center justify-between border-b border-line bg-white/90 px-6 py-4 backdrop-blur">
        <div>
          <div className="text-lg font-extrabold">{ctx.restaurantName}</div>
          <div className="text-xs text-ink3">Merchant dashboard · {ctx.staffRole}</div>
        </div>
        <div className="flex items-center gap-3">
          <span
            className={`rounded-full px-3 py-1 text-xs font-semibold ${
              ctx.isOpen ? 'bg-greensoft text-green' : 'bg-redsoft text-red'
            }`}
          >
            {ctx.isOpen ? 'Open' : 'Closed'}
          </span>
          <SignOutButton />
        </div>
      </header>

      <OrderQueue context={ctx} initialOrders={(orders as MerchantOrder[]) ?? []} />
    </main>
  );
}
