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

/**
 * [202 F-03] The language the person has already chosen, read straight from the
 * session store's persisted blob.
 *
 * Read rather than imported on purpose: the data layer must not depend on the
 * store (the dependency runs the other way), and this is the one moment — row
 * creation — where the value has to be available to a repository. The key and
 * shape are `@sharmeats:session:v1` / `{ locale }` from src/store/session.ts.
 *
 * Falls back to 'en' (the store's own tourist-first default) rather than to the
 * database's 'ar', so a first launch with no stored session still gets sensible
 * push copy.
 */
const SESSION_STORAGE_KEY = '@sharmeats:session:v1';
const SUPPORTED_LOCALES = ['en', 'ar', 'ru', 'it', 'de'] as const;

async function readPersistedLocale(): Promise<string> {
  try {
    const raw = await AsyncStorage.getItem(SESSION_STORAGE_KEY);
    if (!raw) return 'en';
    const parsed = JSON.parse(raw) as { locale?: unknown };
    return (SUPPORTED_LOCALES as readonly string[]).includes(parsed.locale as string)
      ? (parsed.locale as string)
      : 'en';
  } catch {
    return 'en';
  }
}

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
  /**
   * Current session's user id, or null if genuinely not signed in.
   *
   * THROWS rather than returning null when the answer is UNKNOWN. The Supabase
   * client returns `{ data: { user: null }, error }` on a failed lookup, so
   * reading only `data` collapses two different facts into the same value:
   * "nobody is signed in" and "we could not find out". Identity teardown asks
   * this question to decide whether a credential survived a failed sign-out,
   * and there an unknown must never be reported as absence.
   */
  async currentUserId(): Promise<string | null> {
    const { data, error } = await getSupabase().auth.getUser();
    if (error) {
      // AuthSessionMissingError is the library's way of saying "there is no
      // session" — that IS the answer, not a failure to obtain it.
      const name = (error as { name?: string }).name ?? '';
      const status = (error as { status?: number }).status;
      if (name === 'AuthSessionMissingError' || status === 401) return null;
      throw error;
    }
    return data.user?.id ?? null;
  },

  /**
   * Is a credential still persisted on THIS device?
   *
   * Reads local storage rather than the network, so it can answer while
   * offline — which is exactly the case where sign-out failed and the caller
   * most needs to know whether tokens survived. `getSession()` is local-only;
   * it does not round-trip.
   */
  async hasLocalCredential(): Promise<boolean> {
    const { data, error } = await getSupabase().auth.getSession();
    // Unknown is treated as "yes, assume a credential remains": teardown must
    // fail closed, and claiming the device is clean when we cannot tell is the
    // failure this exists to prevent.
    if (error) return true;
    return data.session != null;
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

    // [202 F-03] Seed the locale at row creation. handle_new_user (mig 124)
    // sets users.locale from `coalesce(raw_user_meta_data->>'locale', 'ar')`,
    // and this call passed no metadata — so EVERY account was born 'ar' and
    // every server-composed push ignored the language the person had chosen.
    // Reading the persisted store here (rather than importing it, which would
    // make the data layer depend on the store) keeps the layering intact.
    const { data, error } = await sb.auth.signInAnonymously({
      options: { data: { locale: await readPersistedLocale() } },
    });
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

  /**
   * Revoke this device's session.
   *
   * THROWS on a returned error. The Supabase client reports failure as a
   * returned `{ error }`, not a rejection, so awaiting it without inspecting
   * the result made every sign-out look successful — including one that left
   * working tokens on the device. Identity teardown records "credentials
   * revoked" from this call, so a silent failure there is a false claim about
   * a security-relevant step.
   */
  async signOut(): Promise<void> {
    try {
      const { error } = await getSupabase().auth.signOut();
      if (error) throw error;
    } finally {
      // Runs whether or not the revoke succeeded: the pending-verification
      // record is local, belongs to the departing identity either way, and
      // must not survive because the network was down.
      await clearPendingVerification().catch(() => {});
    }
  },
};
