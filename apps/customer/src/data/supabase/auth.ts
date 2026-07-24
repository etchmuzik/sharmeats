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
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getSupabase } from './client';

export interface SessionInfo {
  userId: string;
  isAnonymous: boolean;
}

const PENDING_VERIFICATION_KEY = '@sharmeats:pending-phone-verification:v1';
const PENDING_VERIFICATION_TTL_MS = 10 * 60 * 1000;

interface PendingVerification {
  type: 'sms' | 'phone_change';
  phone: string;
  originatingUserId: string | null;
  expiresAt: number;
}

function normalizePhone(phone: string): string {
  return phone.replace(/\s+/g, '');
}

async function persistPendingVerification(
  type: PendingVerification['type'],
  phone: string,
  originatingUserId: string | null,
): Promise<void> {
  const pending: PendingVerification = {
    type,
    phone: normalizePhone(phone),
    originatingUserId,
    expiresAt: Date.now() + PENDING_VERIFICATION_TTL_MS,
  };
  try {
    await AsyncStorage.setItem(PENDING_VERIFICATION_KEY, JSON.stringify(pending));
  } catch {
    // The OTP may already have been sent, but verifying without knowing whether
    // it is an SMS sign-in or an anonymous-user phone change can switch auth.uid()
    // and orphan orders. Fail closed and let the customer request another code.
    throw new Error('Could not save verification state. Request a new code.');
  }
}

async function clearPendingVerification(): Promise<void> {
  await AsyncStorage.removeItem(PENDING_VERIFICATION_KEY);
}

async function readPendingVerification(phone: string): Promise<PendingVerification> {
  let raw: string | null;
  try {
    raw = await AsyncStorage.getItem(PENDING_VERIFICATION_KEY);
  } catch {
    throw new Error('Could not restore verification state. Request a new code.');
  }
  if (!raw) throw new Error('Verification flow expired. Request a new code.');

  try {
    const parsed = JSON.parse(raw) as Partial<PendingVerification>;
    const validType = parsed.type === 'sms' || parsed.type === 'phone_change';
    const validPhone = parsed.phone === normalizePhone(phone);
    const validExpiry =
      typeof parsed.expiresAt === 'number' && parsed.expiresAt > Date.now();
    const validOrigin =
      parsed.type === 'sms' ||
      (typeof parsed.originatingUserId === 'string' && parsed.originatingUserId.length > 0);
    if (!validType || !validPhone || !validExpiry || !validOrigin) {
      await clearPendingVerification().catch(() => {});
      throw new Error('Verification flow expired. Request a new code.');
    }
    return parsed as PendingVerification;
  } catch (error) {
    if (error instanceof Error && /request a new code/i.test(error.message)) throw error;
    await clearPendingVerification().catch(() => {});
    throw new Error('Verification flow expired. Request a new code.');
  }
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

  /**
   * Send an SMS OTP to `phone` (E.164, e.g. +201001234567). Called from the
   * sign-in screen. Requires a Phone provider (Twilio/MessageBird/Vonage) to be
   * enabled in the Supabase dashboard (Authentication → Providers → Phone).
   *
   * CRITICAL: if the current session is ANONYMOUS (guest checkout), we must
   * LINK the phone to that anon user via updateUser() + verifyOtp(phone_change)
   * so auth.uid() is preserved and the guest's in-flight order, addresses, and
   * favourites carry over. Using signInWithOtp/verifyOtp(sms) here would create
   * a *different* user and swap the session, orphaning all of it. We persist
   * which flow was used so verifyOtp() below picks the matching verify type.
   */
  async sendOtp(phone: string): Promise<void> {
    const sb = getSupabase();
    const normalizedPhone = normalizePhone(phone);
    const {
      data: { session },
    } = await sb.auth.getSession();
    const isAnon = session?.user?.is_anonymous ?? false;

    if (isAnon) {
      // Link the phone to the current anonymous user (preserves auth.uid()).
      const { error } = await sb.auth.updateUser({ phone: normalizedPhone });
      if (!error) {
        await persistPendingVerification(
          'phone_change',
          normalizedPhone,
          session?.user?.id ?? null,
        );
        return;
      }
      // updateUser fails if the phone already belongs to another account
      // ("phone_exists" / already registered). In that case this is a RETURNING
      // user — fall through to the plain sign-in flow (their real account +
      // history is more valuable than merging the throwaway guest cart).
      if (!/exist|registered|taken|already/i.test(error.message)) {
        const hint = /provider|not enabled|disabled|sms/i.test(error.message)
          ? ' — enable a Phone provider in Supabase → Authentication → Providers → Phone.'
          : '';
        throw new Error(`Could not send the code${hint} (${error.message})`);
      }
    }

    // Non-anonymous session, or a returning phone that already has an account:
    // sign into / create the phone user directly.
    const { error } = await sb.auth.signInWithOtp({ phone: normalizedPhone });
    if (error) {
      const hint = /provider|not enabled|disabled|sms/i.test(error.message)
        ? ' — enable a Phone provider in Supabase → Authentication → Providers → Phone.'
        : '';
      throw new Error(`Could not send the code${hint} (${error.message})`);
    }
    await persistPendingVerification('sms', normalizedPhone, null);
  },

  /**
   * Verify the SMS OTP. Uses the verify type chosen by sendOtp():
   *   - 'phone_change' when linking to the current anon user (auth.uid()
   *     preserved → order history/addresses carry over), or
   *   - 'sms' for a returning/new phone user (fresh session).
   * We mirror the verified phone into public.users so checkout can prefill a
   * trusted number. Returns the user id + phone.
   */
  async verifyOtp(phone: string, code: string): Promise<{ userId: string; phone: string }> {
    const sb = getSupabase();
    const normalizedPhone = normalizePhone(phone);
    const pending = await readPendingVerification(normalizedPhone);

    if (pending.type === 'phone_change') {
      const {
        data: { session },
      } = await sb.auth.getSession();
      if (!session?.user || session.user.id !== pending.originatingUserId) {
        await clearPendingVerification().catch(() => {});
        throw new Error('Your verification session changed. Request a new code.');
      }
    }

    const { data, error } = await sb.auth.verifyOtp(
      pending.type === 'phone_change'
        ? { phone: normalizedPhone, token: code, type: 'phone_change' }
        : { phone: normalizedPhone, token: code, type: 'sms' },
    );
    if (error) throw new Error(`Invalid or expired code (${error.message})`);
    const user = data.user;
    if (!user) throw new Error('Verification returned no user.');
    await clearPendingVerification().catch(() => {});

    // Mirror the verified number onto the profile row (best-effort; the order
    // flow doesn't depend on it succeeding).
    try {
      await sb
        .from('users')
        .update({ phone: user.phone ?? normalizedPhone })
        .eq('id', user.id);
    } catch {
      /* non-fatal */
    }
    return { userId: user.id, phone: user.phone ?? normalizedPhone };
  },

  async signOut(): Promise<void> {
    try {
      await getSupabase().auth.signOut();
    } finally {
      await clearPendingVerification().catch(() => {});
    }
  },
};
