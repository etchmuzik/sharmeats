'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';
import type { Restaurant } from '@/lib/types';
import { SignOutButton } from '../SignOutButton';
import { Icon } from '../Icon';
import { useToast } from '../Toast';
import { Skeleton } from '../Skeleton';
import { RestaurantEditor } from './RestaurantEditor';

type Phase =
  | { state: 'loading' }
  | { state: 'unauthorized' }
  | { state: 'ready'; displayName: string };

/**
 * Menu manager root — edit restaurants + menus live, no app rebuild needed.
 *
 * Same client-side auth gate as the dispatch board (page.tsx): admin only
 * (writes are RLS-gated to auth_role()='admin'). Lists every restaurant;
 * selecting one opens the full editor. Changes hit Supabase directly and are
 * visible in the customer app immediately.
 */
export default function MenuPage() {
  const router = useRouter();
  const { toast } = useToast();
  const [phase, setPhase] = useState<Phase>({ state: 'loading' });
  const [restaurants, setRestaurants] = useState<Restaurant[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const loadRestaurants = useCallback(async () => {
    const supabase = createSupabaseBrowserClient();
    const { data, error } = await supabase
      .from('restaurants')
      .select(
        'id, slug, name, description, cuisines, cuisine_label, cover_image, logo, zone, rating, rating_count, prep_time_low, prep_time_high, delivery_fee_egp, min_order_egp, tourist_safe, is_open, is_open_24h, featured, promo, is_active',
      )
      .order('name', { ascending: true });
    if (error) {
      toast('Could not load restaurants', 'error');
      return;
    }
    setRestaurants((data as Restaurant[]) ?? []);
  }, [toast]);

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
      const { data: me } = await supabase
        .from('users')
        .select('role, display_name')
        .eq('id', session.user.id)
        .single();
      // Menu writes need admin (RLS). Dispatchers can view the board but not edit menus.
      if ((me?.role as string | undefined) !== 'admin') {
        if (!cancelled) setPhase({ state: 'unauthorized' });
        return;
      }
      await loadRestaurants();
      if (!cancelled) setPhase({ state: 'ready', displayName: me?.display_name ?? 'Admin' });
    })();

    return () => {
      cancelled = true;
    };
  }, [router, loadRestaurants]);

  const selected = restaurants.find((r) => r.id === selectedId) ?? null;

  if (phase.state === 'loading') {
    return (
      <main className="min-h-screen bg-bg">
        <header className="flex items-center justify-between border-b border-line bg-white px-6 py-4">
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-8 w-20" />
        </header>
        <div className="mx-auto max-w-4xl space-y-3 p-6">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-16 w-full" />
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
          <p className="mt-2 text-ink2">Editing restaurants and menus requires an admin account.</p>
          <div className="mt-6 flex justify-center gap-3">
            <a href="/" className="rounded-lg border border-line px-4 py-2 text-sm font-semibold">
              Back to dispatch
            </a>
            <SignOutButton />
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-bg">
      <header className="sticky top-0 z-10 flex items-center justify-between border-b border-line bg-white/90 px-6 py-4 backdrop-blur">
        <div className="flex items-center gap-4">
          {selected ? (
            <button
              onClick={() => setSelectedId(null)}
              className="flex items-center gap-1 text-sm font-semibold text-ink2 hover:text-ink"
            >
              <Icon name="back" size={16} /> All restaurants
            </button>
          ) : (
            <a href="/" className="flex items-center gap-1 text-sm font-semibold text-ink2 hover:text-ink">
              <Icon name="back" size={16} /> Dispatch
            </a>
          )}
          <div>
            <div className="text-lg font-extrabold">
              Sharm Eats <span className="text-accent">Menu</span>
            </div>
            <div className="text-xs text-ink3">
              {selected ? selected.name : 'Restaurants & menus'} · {phase.displayName}
            </div>
          </div>
        </div>
        <SignOutButton />
      </header>

      {selected ? (
        <RestaurantEditor
          restaurant={selected}
          onSaved={loadRestaurants}
          onDeleted={() => {
            setSelectedId(null);
            loadRestaurants();
          }}
        />
      ) : (
        <RestaurantList
          restaurants={restaurants}
          onSelect={setSelectedId}
          onCreated={async (id) => {
            await loadRestaurants();
            setSelectedId(id);
          }}
        />
      )}
    </main>
  );
}

function RestaurantList({
  restaurants,
  onSelect,
  onCreated,
}: {
  restaurants: Restaurant[];
  onSelect: (id: string) => void;
  onCreated: (id: string) => void;
}) {
  const { toast } = useToast();
  const [creating, setCreating] = useState(false);

  const createRestaurant = async () => {
    if (creating) return;
    setCreating(true);
    const supabase = createSupabaseBrowserClient();
    // Minimal valid row — required NOT NULL/no-default fields: name, cover_image, zone, slug.
    const stamp = Date.now().toString(36);
    const { data, error } = await supabase
      .from('restaurants')
      .insert({
        name: 'New restaurant',
        slug: `new-restaurant-${stamp}`,
        cover_image: 'https://placehold.co/800x600?text=Cover',
        zone: 'naama',
        is_active: false, // hidden from customers until you fill it in + activate
      })
      .select('id')
      .single();
    setCreating(false);
    if (error || !data) {
      toast(error?.message ?? 'Could not create restaurant', 'error');
      return;
    }
    toast('Restaurant created — fill in the details', 'success');
    onCreated(data.id as string);
  };

  return (
    <div className="mx-auto max-w-4xl p-6">
      <div className="mb-4 flex items-center justify-between">
        <div className="text-sm text-ink2">{restaurants.length} restaurants</div>
        <button
          onClick={createRestaurant}
          disabled={creating}
          className="flex items-center gap-1.5 rounded-lg bg-accent px-3.5 py-2 text-sm font-bold text-white disabled:opacity-60"
        >
          <Icon name="plus" size={16} /> New restaurant
        </button>
      </div>

      <div className="overflow-hidden rounded-2xl border border-line bg-white">
        {restaurants.map((r, i) => (
          <button
            key={r.id}
            onClick={() => onSelect(r.id)}
            className={`flex w-full items-center gap-4 px-4 py-3 text-left hover:bg-bg ${
              i < restaurants.length - 1 ? 'border-b border-line' : ''
            }`}
          >
            <div
              className="h-12 w-12 flex-shrink-0 rounded-lg bg-sand bg-cover bg-center"
              style={{ backgroundImage: `url(${r.cover_image})` }}
            />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="truncate font-bold">{r.name}</span>
                {!r.is_active && (
                  <span className="rounded bg-sand px-1.5 py-0.5 text-[10px] font-bold uppercase text-ink3">
                    Hidden
                  </span>
                )}
                {!r.is_open && r.is_active && (
                  <span className="rounded bg-red/10 px-1.5 py-0.5 text-[10px] font-bold uppercase text-red">
                    Closed
                  </span>
                )}
              </div>
              <div className="truncate text-xs text-ink3">
                {r.cuisine_label || r.cuisines.join(', ') || '—'} · {r.zone}
              </div>
            </div>
            <Icon name="chevronRight" size={18} className="flex-shrink-0 text-ink3" />
          </button>
        ))}
        {restaurants.length === 0 && (
          <div className="px-4 py-10 text-center text-ink3">
            No restaurants yet. Create your first one.
          </div>
        )}
      </div>
    </div>
  );
}
