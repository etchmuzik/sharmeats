/**
 * Supabase auth adapter.
 *
 * For M1 validation (and as a real guest-checkout path), the app boots into an
 * ANONYMOUS Supabase session. Anonymous sign-in mints a real JWT with a stable
 * `auth.uid()`, which is exactly what the server-authority RPCs need
 * (place_order checks auth.uid() and writes orders.user_id). The
 * `on_auth_user_created` trigger auto-creates the matching public.users row.
 *
 * Later, "claim your account" upgrades the anonymous user to phone/email via
 * supabase.auth.updateUser()/linkIdentity(), preserving order history.
 *
 * Requires Anonymous sign-ins to be ENABLED in the Supabase dashboard
 * (Authentication → Providers → Anonymous). If disabled, ensureSession() throws
 * a clear, actionable error instead of failing deep in checkout.
 */
import { getSupabase } from './client';

export interface SessionInfo {
  userId: string;
  isAnonymous: boolean;
}

export const authRepoSupabase = {
  /** Current session's user id, or null if not signed in. */
  async currentUserId(): Promise<string | null> {
    const {
      data: { user },
    } = await getSupabase().auth.getUser();
    return user?.id ?? null;
  },

  /**
   * Guarantee a session exists. If one is already present (persisted), reuse it;
   * otherwise sign in anonymously. Safe to call on every app boot.
   */
  async ensureSession(): Promise<SessionInfo> {
    const sb = getSupabase();
    const {
      data: { session },
    } = await sb.auth.getSession();

    if (session?.user) {
      return { userId: session.user.id, isAnonymous: session.user.is_anonymous ?? false };
    }

    const { data, error } = await sb.auth.signInAnonymously();
    if (error) {
      // Most common cause: the provider is off. Make that obvious.
      const hint =
        error.message?.toLowerCase().includes('anonymous') || error.status === 422
          ? ' — enable Authentication → Providers → Anonymous in the Supabase dashboard.'
          : '';
      throw new Error(`Could not start a session${hint} (${error.message})`);
    }
    const user = data.user;
    if (!user) throw new Error('Anonymous sign-in returned no user.');
    return { userId: user.id, isAnonymous: true };
  },

  async signOut(): Promise<void> {
    await getSupabase().auth.signOut();
  },
};
