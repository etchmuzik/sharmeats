/**
 * Supabase browser client (merchant-web) — for Client Components.
 *
 * Used for Realtime subscriptions (live order queue) and client-side mutations
 * (accept/reject via advance_order_status RPC). Shares the cookie-based session
 * with the server client.
 */
'use client';

import { createBrowserClient } from '@supabase/ssr';

let cached: ReturnType<typeof createBrowserClient> | null = null;

export function createSupabaseBrowserClient() {
  if (cached) return cached;
  cached = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
  return cached;
}
