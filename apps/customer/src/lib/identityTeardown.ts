/**
 * Identity transition — everything that must change when the person changes.
 *
 * The device is shared. A phone gets handed to a friend, sold, or returned to a
 * hotel desk; one Sharm Eats install can serve several people in a week. Server
 * authority (RLS, the vertical gates) governs what a NEW session may FETCH, but
 * says nothing about what the PREVIOUS session already put on this device or
 * still holds in memory. That residue is a local problem and needs a local fix.
 *
 * WHY ONE AWAITED SERVICE RATHER THAN A LIST OF CALLS AT EACH SITE.
 * The teardown was previously open-coded at two call sites and each had a
 * different subset, which is how the gaps arose:
 *
 *   * Profile sign-out never called Supabase `signOut()` at all, so the SDK kept
 *     VALID access/refresh tokens for the departing account; anything reading
 *     the client directly still acted as that user until the next cold launch.
 *   * Neither site cleared `@sharmeats:cart:v1` -- a separate store with its own
 *     key -- so the next person saw the previous basket: item names, free-text
 *     notes, and their ALLERGEN selections (health data they entered about
 *     themselves).
 *   * Removing the storage key is NOT enough on its own: the Zustand cart holds
 *     `lines` in MEMORY. A mounted cart screen keeps rendering the old basket
 *     after the bytes are gone, and the next write persists it straight back.
 *   * The steps were fire-and-forget, so navigation could reach the next screen
 *     while teardown was still in flight -- and a rejected promise surfaced as
 *     an unhandled rejection instead of being handled.
 *
 * ORDER MATTERS and is deliberate:
 *   1. unregister push   -- while the token still belongs to this identity.
 *   2. Supabase signOut  -- revoke credentials before dropping local state, so a
 *                           crash mid-teardown cannot leave usable tokens with
 *                           the UI already showing signed-out.
 *   3. in-memory reset   -- cart + session + analytics, so nothing on screen or
 *                           in a store still holds the departing person's data.
 *   4. storage purge     -- remove, don't blank; absence is the only state that
 *                           proves nothing was retained.
 *   5. fresh anon session-- the app requires a session to browse at all, so
 *                           leaving none would strand the next user on errors.
 *
 * Step 5 is best-effort: it needs the network, and failing to get a new
 * anonymous session must not turn a SUCCESSFUL deletion into an error. The app's
 * normal boot path calls `ensureSession()` anyway, so a failure here self-heals.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { db } from '../data';
import { useCart } from '../store/cart';
import { useSession } from '../store/session';
import { resetAnalyticsUser } from './analytics';
import { clearNotificationAttribution } from './notificationAttribution';
import { unregisterPush } from './push';

/**
 * Every AsyncStorage key whose contents belong to ONE identity.
 *
 * Deliberately NOT here: locale and currency. Those are device preferences, not
 * personal data — resetting the phone to English because someone signed out
 * would be a regression, not a privacy win. Anything holding a person's own
 * data does belong here, and adding a key to this list is the whole fix.
 */
export const IDENTITY_SCOPED_KEYS = [
  '@sharmeats:cart:v1',
  '@sharmeats:session:v1',
  '@sharmeats:pending-phone-verification:v1',
] as const;

/** What actually happened, so callers and tests can assert instead of trust. */
export interface IdentityTransitionResult {
  /** Supabase credentials were revoked. */
  authSignedOut: boolean;
  /** Keys removed from device storage. */
  removedKeys: string[];
  /** A fresh anonymous session was established (false = retry on next boot). */
  anonymousSessionReady: boolean;
  /**
   * A credential for the departing identity was still present after sign-out,
   * OR could not be proven absent. When true no new session was established --
   * see step 5. The device is session-less rather than signed in as the
   * previous person. Fails closed: uncertainty counts as residual.
   */
  residualCredential: boolean;
  /**
   * Both halves proven: no local credential AND every identity-scoped key
   * removed. Callers should not present the device as "handed over" unless
   * this is true.
   */
  isolationComplete: boolean;
}

/** Remove every identity-scoped key. Best-effort per key; never throws. */
async function purgeScopedStorage(): Promise<string[]> {
  const removed: string[] = [];
  await Promise.all(
    IDENTITY_SCOPED_KEYS.map(async (key) => {
      try {
        await AsyncStorage.removeItem(key);
        removed.push(key);
      } catch {
        // Swallowed by design: teardown runs after the authoritative step has
        // already succeeded, so a storage error must not be reported as failure.
      }
    }),
  );
  return removed;
}

/**
 * Hand this device to a different person.
 *
 * Awaited end-to-end so callers can navigate only once isolation is real.
 * Individual steps are individually fault-tolerant — the caller's outcome
 * (signed out, or account deleted) has already been decided by the time this
 * runs, and no step here may reverse that verdict.
 */
export async function transitionIdentity(): Promise<IdentityTransitionResult> {
  // 1. Stop this device receiving the departing account's pushes, while the
  //    token is still associated with them.
  await unregisterPush().catch(() => {});

  // 2. Revoke credentials BEFORE local state goes, so there is no window where
  //    the UI looks signed out while the SDK still holds working tokens.
  let authSignedOut = false;
  try {
    await db.auth.signOut();
    authSignedOut = true;
  } catch {
    // Offline sign-out: the local session is still dropped below, and the
    // tokens are useless without our RLS-gated backend accepting them.
  }

  // 3. In-memory state. AsyncStorage removal alone leaves the live stores
  //    holding the previous basket — a mounted cart screen would keep showing
  //    it and the next write would persist it straight back.
  useCart.getState().clear();
  useSession.getState().signOut();
  resetAnalyticsUser();
  // [P03-F] Forget any open notification-attribution window, so the next person to
  // use this device does not have their orders credited to a campaign the previous
  // person tapped.
  clearNotificationAttribution();

  // 4. Bytes at rest. Remove rather than blank: `clear()` above writes an empty
  //    cart shape back, and "present but empty" is not the same as absent.
  const removedKeys = await purgeScopedStorage();

  // 5. The app needs SOME session to browse -- but establishing one FAILS CLOSED.
  //
  //    ensureSession() returns the EXISTING session when there is one and only
  //    signs in anonymously when there isn't. So calling it unconditionally
  //    after a failed sign-out would hand back the DEPARTING user's session and
  //    call it "ready" -- the exact opposite of isolation. Verify the credential
  //    is actually gone first, and if it is not, leave the app session-less and
  //    say so rather than adopting the old identity.
  //    Residual-credential detection reads LOCAL state, and treats any
  //    uncertainty as "a credential remains".
  //
  //    Asking the network (`currentUserId`) was not sufficient: the Supabase
  //    client reports failure as a returned `{ user: null, error }`, so a
  //    lookup that FAILED looked identical to "nobody is signed in". Combined
  //    with a signOut that also swallowed its `{ error }`, both flags could
  //    read "clean" while working tokens sat on the device. `hasLocalCredential`
  //    inspects the persisted session instead: it needs no network (so it still
  //    answers when sign-out failed because we are offline) and it fails closed.
  let residualCredential = true;
  try {
    residualCredential = await db.auth.hasLocalCredential();
  } catch {
    // Cannot determine => must not claim absence.
    residualCredential = true;
  }

  let anonymousSessionReady = false;
  if (!residualCredential) {
    try {
      await db.auth.ensureSession();
      anonymousSessionReady = true;
    } catch {
      // No session, but nothing stale either. Boot calls ensureSession() again.
    }
  }
  // else: a credential survived. Deliberately NO ensureSession() call -- it
  // returns the EXISTING session when one is present, so calling it here would
  // hand back the departing user and call it "ready". Browsing session-less is
  // safer than browsing as the previous person.

  return {
    authSignedOut,
    removedKeys,
    anonymousSessionReady,
    residualCredential,
    // Isolation is only COMPLETE when the credential is gone AND every scoped
    // key was actually removed. A storage failure leaves the previous person's
    // basket on the device, which is the leak this whole path exists to close.
    isolationComplete: !residualCredential && removedKeys.length === IDENTITY_SCOPED_KEYS.length,
  };
}
