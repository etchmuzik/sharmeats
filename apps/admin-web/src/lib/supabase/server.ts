/**
 * Supabase client for Server Components / Route Handlers (merchant-web).
 *
 * Reads the auth session from cookies and respects RLS as the logged-in
 * merchant staffer. Use this for the initial authenticated data fetch in
 * Server Components (e.g. the current order queue), then hand the data to a
 * Client Component that owns the Realtime subscription.
 */
import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { cookies } from 'next/headers';

type CookieToSet = { name: string; value: string; options?: CookieOptions };

export async function createSupabaseServerClient() {
  const cookieStore = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet: CookieToSet[]) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // Called from a Server Component without a mutable cookie store —
            // safe to ignore; middleware refreshes the session.
          }
        },
      },
    },
  );
}
