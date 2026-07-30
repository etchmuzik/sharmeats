'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { getSupabase, isSupabaseConfigured } from '@/lib/supabase';

/**
 * The shape mig 184's get_shared_order returns. Deliberately small: no address,
 * no items, no prices, no phone, no customer name, no ids.
 */
interface SharedOrder {
  short_code: string;
  status: string;
  eta_at: string | null;
  restaurant_name: string | null;
  restaurant_lat: number | null;
  restaurant_lng: number | null;
  driver_name: string | null;
  driver_vehicle: string | null;
  driver_rating: number | null;
  driver_lat: number | null;
  driver_lng: number | null;
  driver_pinged_at: string | null;
}

const STEPS = ['accepted', 'preparing', 'ready', 'picked_up', 'out_for_delivery'] as const;

const STATUS_COPY: Record<string, string> = {
  placed: 'Order placed',
  accepted: 'Accepted by the restaurant',
  preparing: 'Being prepared',
  ready: 'Ready for pickup',
  picked_up: 'Picked up',
  out_for_delivery: 'On the way',
  delivered: 'Delivered',
  cancelled: 'Cancelled',
  rejected: 'Cancelled',
};

/** Poll interval. The driver ping is throttled server-side, so faster buys nothing. */
const POLL_MS = 15_000;

/**
 * A position is stale if the driver has not pinged recently — mirrors the
 * customer app's own "reconnecting" treatment rather than showing a dot that is
 * quietly minutes old.
 */
const STALE_AFTER_MS = 90_000;

function minutesUntil(iso: string | null, nowMs: number): number | null {
  if (!iso) return null;
  const ms = new Date(iso).getTime() - nowMs;
  if (!Number.isFinite(ms)) return null;
  return Math.round(ms / 60_000);
}

export default function TrackView() {
  const [token, setToken] = useState<string | null>(null);
  const [order, setOrder] = useState<SharedOrder | null>(null);
  const [state, setState] = useState<'loading' | 'ok' | 'gone' | 'error'>('loading');
  const [now, setNow] = useState(() => Date.now());
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  // Query param rather than a path segment: this site is a static export, so a
  // dynamic [token] route would need generateStaticParams for tokens that do not
  // exist at build time.
  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get('t');
    setToken(t && t.length > 0 ? t : null);
    if (!t) setState('gone');
  }, []);

  const load = useCallback(async (t: string) => {
    if (!isSupabaseConfigured()) {
      setState('error');
      return;
    }
    try {
      const { data, error } = await getSupabase().rpc('get_shared_order', { p_token: t });
      if (error) throw error;
      const row = Array.isArray(data) ? data[0] : data;
      if (!row) {
        // Revoked, expired, or never existed — all indistinguishable on purpose.
        setState('gone');
        setOrder(null);
        return;
      }
      setOrder(row as SharedOrder);
      setState('ok');
    } catch {
      setState('error');
    }
  }, []);

  useEffect(() => {
    if (!token) return;
    void load(token);
    timer.current = setInterval(() => {
      setNow(Date.now());
      void load(token);
    }, POLL_MS);
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, [token, load]);

  if (state === 'loading') {
    return <Shell><p className="text-ink2">Loading…</p></Shell>;
  }

  if (state === 'error') {
    return (
      <Shell>
        <h1 className="text-2xl font-extrabold">Something went wrong</h1>
        <p className="mt-2 text-ink2">Try refreshing the page.</p>
      </Shell>
    );
  }

  if (state === 'gone' || !order) {
    return (
      <Shell>
        <h1 className="text-2xl font-extrabold">This link isn&apos;t active</h1>
        <p className="mt-2 max-w-md text-ink2">
          Tracking links stop working once the delivery is finished, or when the person who
          shared it turns sharing off.
        </p>
        <StoreLinks />
      </Shell>
    );
  }

  const terminal = ['delivered', 'cancelled', 'rejected'].includes(order.status);
  const stepIndex = STEPS.indexOf(order.status as (typeof STEPS)[number]);
  const etaMin = minutesUntil(order.eta_at, now);
  const pingAge = order.driver_pinged_at ? now - new Date(order.driver_pinged_at).getTime() : null;
  const positionStale = pingAge !== null && pingAge > STALE_AFTER_MS;
  const hasDot = order.driver_lat !== null && order.driver_lng !== null;

  return (
    <Shell>
      <p className="text-xs font-bold uppercase tracking-widest text-ink3">
        Order {order.short_code}
      </p>
      <h1 className="mt-1 text-3xl font-extrabold tracking-tight">
        {STATUS_COPY[order.status] ?? order.status}
      </h1>

      {!terminal && etaMin !== null && (
        <p className="mt-1 text-ink2">
          {etaMin > 0 ? `Arriving in about ${etaMin} min` : 'Arriving any moment'}
        </p>
      )}
      {order.restaurant_name && (
        <p className="mt-1 text-ink2">From {order.restaurant_name}</p>
      )}

      {/* Progress. Deliberately coarse — five states, no timestamps. */}
      {!terminal && (
        <ol className="mt-6 flex gap-1.5" aria-label="Delivery progress">
          {STEPS.map((s, i) => (
            <li
              key={s}
              className={`h-1.5 flex-1 rounded-full ${i <= stepIndex ? 'bg-accent' : 'bg-line'}`}
            />
          ))}
        </ol>
      )}

      {order.driver_name && !terminal && (
        <div className="mt-6 flex items-center gap-3 rounded-2xl border border-line bg-white p-4">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-accentSoft text-sm font-extrabold text-accentDark">
            {order.driver_name.charAt(0)}
          </div>
          <div className="min-w-0 flex-1">
            <p className="font-bold">{order.driver_name}</p>
            <p className="text-xs text-ink2">
              {order.driver_vehicle}
              {order.driver_rating ? ` · ★ ${order.driver_rating}` : ''}
            </p>
          </div>
          {hasDot && (
            <span
              className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${
                positionStale ? 'bg-sand text-ink2' : 'bg-seaSoft text-sea'
              }`}
            >
              {positionStale ? 'Reconnecting' : 'Live'}
            </span>
          )}
        </div>
      )}

      {hasDot && (
        <div className="mt-4 overflow-hidden rounded-2xl border border-line">
          <iframe
            title="Driver location"
            className="h-64 w-full border-0"
            loading="lazy"
            referrerPolicy="no-referrer-when-downgrade"
            src={osmEmbedUrl(order.driver_lat as number, order.driver_lng as number)}
          />
        </div>
      )}

      {/* Said plainly, because the recipient did not consent to anything and
          should know what they are and are not being shown. */}
      <p className="mt-4 text-xs leading-relaxed text-ink3">
        This page shows the courier&apos;s position while the order is moving. It never shows
        the delivery address, the order contents, or anyone&apos;s contact details. It stops
        working when the delivery finishes.
      </p>

      <StoreLinks />
    </Shell>
  );
}

/**
 * OpenStreetMap embed rather than a Google Maps key: this page is served from a
 * static export with no server to proxy a key through, and shipping a billable
 * key in public HTML for an unauthenticated page invites abuse.
 */
function osmEmbedUrl(lat: number, lng: number): string {
  const d = 0.006; // ~600 m box; enough context without pinpointing a building
  const bbox = [lng - d, lat - d / 2, lng + d, lat + d / 2].join('%2C');
  return `https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&layer=mapnik&marker=${lat}%2C${lng}`;
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-screen bg-bg">
      <div className="mx-auto max-w-lg px-6 py-12">
        <Link href="/" className="text-xl font-extrabold tracking-tight">
          Sharm<span className="text-accent">Eats</span>
        </Link>
        <div className="mt-8">{children}</div>
      </div>
    </main>
  );
}

function StoreLinks() {
  return (
    <p className="mt-8 text-sm text-ink2">
      Ordering in Sharm el-Sheikh?{' '}
      <Link href="/#download" className="font-bold text-accent underline">
        Get the app
      </Link>
      .
    </p>
  );
}
