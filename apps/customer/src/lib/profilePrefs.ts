/**
 * Mirror the session's language + currency onto the profile row.
 *
 * `users.locale` and `users.preferred_currency` exist, the repository layer maps
 * both, and NO client ever wrote either. `users.locale` defaults to 'ar' at
 * signup, so every server-composed message — push notifications above all —
 * addressed a German tourist reading the app in English in Arabic. The columns
 * were correct; nobody was filling them in.
 *
 * Called at the three moments the answer can change:
 *   - sign-in completes (the profile row now belongs to a known person),
 *   - the language switcher is used,
 *   - the currency switcher is used.
 *
 * Deliberately best-effort and never awaited by the caller. This is a display
 * preference: failing to record it must never block a sign-in, a redirect, or a
 * language change that has ALREADY taken effect locally. A later change, or the
 * next sign-in, retries it.
 */
import { db, isBackendLive } from '../data';
import { useSession } from '../store/session';
import { captureError } from './analytics';

export function syncProfilePreferences(): void {
  if (!isBackendLive) return;
  const { locale, currency } = useSession.getState();
  void db.user
    .update({ locale, preferredCurrency: currency })
    .catch((e: unknown) => {
      // Not silent: a persistent failure here means every push this customer
      // receives is in the wrong language, which is invisible from the client.
      captureError(e, { where: 'profilePrefs.sync' });
    });
}
