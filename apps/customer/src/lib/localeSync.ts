/**
 * Push the customer's chosen language to `public.users.locale`.
 *
 * WHY THIS EXISTS: every server-side push localizes per recipient from
 * users.locale (supabase/functions/expo-push/index.ts -> copy.ts resolveCopy).
 * Nothing ever wrote that column. handle_new_user seeds it with
 * `coalesce(metadata->>'locale', 'ar')` (mig 124) and the app signs in
 * anonymously with no metadata, so EVERY account sat at 'ar' forever — order
 * status, payment_failed, order_rejected and merchant alerts all rendered in
 * Arabic regardless of the language the person picked in the app. The whole
 * 29-events x 5-locales copy layer was unreachable in practice.
 *
 * The in-app UI reads the zustand store, which is correct and stays that way;
 * this is only about the column the SERVER reads when it composes a push.
 *
 * DESIGN NOTES
 *  - Best-effort and non-blocking. A language tap must never show a spinner or
 *    an error: the next sync (or the next sign-in) fixes a missed write, and the
 *    worst case is one push in the previous language.
 *  - Guests are skipped by the repository itself (update() throws without an
 *    authenticated user), so the catch below is the guest path too. An anonymous
 *    Supabase session IS authenticated, so guest-first ordering still gets
 *    localized pushes.
 *  - Mock backend: `db.user` resolves to the mock repository when
 *    EXPO_PUBLIC_USE_SUPABASE is not 'true', which no-ops safely.
 */
import { db } from '../data';
import type { Locale } from '../store/session';

/**
 * Write `locale` to the signed-in user's row. Never throws.
 * Returns true when the write landed, so callers (and tests) can assert.
 */
export async function syncLocaleToProfile(locale: Locale): Promise<boolean> {
  try {
    await db.user.update({ locale });
    return true;
  } catch {
    // Guest, offline, or a transient failure. Deliberately silent: see above.
    return false;
  }
}
