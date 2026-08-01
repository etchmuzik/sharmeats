/**
 * Push the driver's chosen language to `public.users.locale`.
 *
 * WHY THIS EXISTS: every server-side push localizes per recipient from
 * users.locale (supabase/functions/expo-push/index.ts -> copy.ts resolveCopy).
 * The driver app persisted its EN/AR choice only to AsyncStorage, so an
 * Arabic-first driver still received new_offer, order_ready_pickup,
 * order_cancelled_driver, settlement and KYC pushes in English. The Arabic copy
 * exists for every one of those events — only the per-user locale signal the
 * server reads was missing.
 *
 * DESIGN NOTES
 *  - Best-effort and non-blocking. Switching language mid-shift must never show
 *    a spinner or an error; a missed write is fixed by the next switch or the
 *    next app start, and the worst case is one push in the previous language.
 *  - Mirrors apps/customer/src/lib/localeSync.ts. The customer app goes through
 *    its repository layer; driver/restaurant have no such layer, so they write
 *    the column directly. `users_update_self` RLS + the column-level UPDATE
 *    grant on users.locale scope the write to the caller's own row.
 */
import { getSupabase, isSupabaseConfigured } from './supabase';
import type { Locale } from './i18n';

/**
 * Write `locale` to the signed-in driver's row. Never throws.
 * Returns true when the write landed, so callers (and tests) can assert.
 */
export async function syncLocaleToProfile(locale: Locale): Promise<boolean> {
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
