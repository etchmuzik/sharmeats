import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * Browser Supabase client for the static-export landing site.
 *
 * The site ships as a Next.js static export (output: 'export') to Hostinger, so
 * there is no server and no API route. The waitlist form therefore writes to
 * public.waitlist directly with the anon (publishable) key — the same pattern
 * the customer app uses — gated by the INSERT-only RLS policy in migration
 * 063_waitlist_anon_insert.sql. The anon key is public by design; it can only
 * append waitlist rows and never read the list back.
 */
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

let cached: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient {
  if (cached) return cached;
  if (!url || !anonKey) {
    throw new Error(
      'Supabase env not configured. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.',
    );
  }
  cached = createClient(url, anonKey, {
    // No auth session on a static marketing page: the form is an anonymous,
    // fire-and-forget insert. Skipping persistence avoids writing to
    // localStorage and parsing the URL for a session that never exists.
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
  return cached;
}

export function isSupabaseConfigured(): boolean {
  return !!url && !!anonKey;
}
