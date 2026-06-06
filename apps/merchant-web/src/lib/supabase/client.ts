/**
 * Supabase browser client (merchant-web).
 *
 * This dashboard is a pure client-side SPA (static export on shared hosting),
 * so there is no server to read cookies. We use the plain supabase-js client
 * with its default localStorage session persistence — auth lives entirely in
 * the browser. Used for the login flow, the live Realtime order queue, and
 * advance_order_status RPC mutations.
 */
'use client';

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

let cached: SupabaseClient | null = null;

export function createSupabaseBrowserClient(): SupabaseClient {
  if (cached) return cached;
  cached = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    },
  );
  return cached;
}
