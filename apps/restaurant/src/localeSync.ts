/**
 * Push the merchant staffer's chosen language to `public.users.locale`.
 *
 * WHY THIS EXISTS: every server-side push localizes per recipient from
 * users.locale (supabase/functions/expo-push/index.ts -> copy.ts resolveCopy).
 * The restaurant app persisted its EN/AR choice only to AsyncStorage, so
 * Arabic-selecting merchant staff still received order_placed_merchant,
 * low_rating and settlement_* pushes in English. The Arabic copy exists for
 * every one of those events — only the per-user locale signal the server reads
 * was missing.
 *
 * DESIGN NOTES
 *  - Best-effort and non-blocking. A language tap on a kitchen tablet must
 *    never show a spinner or an error; a missed write is fixed by the next
 *    switch, and the worst case is one push in the previous language.
 *  - Mirrors apps/driver/src/localeSync.ts and
 *    apps/customer/src/lib/localeSync.ts. `users_update_self` RLS plus the
 *    column-level UPDATE grant on users.locale scope the write to the caller's
 *    own row.
 */
import { getSupabase, isSupabaseConfigured } from './supabase';
import type { RestaurantLocale } from './i18n';

/**
 * Write `locale` to the signed-in staffer's row. Never throws.
 * Returns true when the write landed, so callers (and tests) can assert.
 */
export async function syncLocaleToProfile(
  locale: RestaurantLocale,
): Promise<boolean> {
  if (!isSupabaseConfigured()) return false;
  try {
    const sb = getSupabase();
    const {
      data: { user },
    } = await sb.auth.getUser();
    if (!user) return false;
    const { error } = await sb
      .from('users')
      .update({ locale })
      .eq('id', user.id);
    return !error;
  } catch {
    // Signed out, offline, or a transient failure. Deliberately silent.
    return false;
  }
}
