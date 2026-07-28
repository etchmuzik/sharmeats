/**
 * The Supabase auth adapter's RESULT contract.
 *
 * The Supabase client reports failure by RETURNING `{ data, error }`, not by
 * rejecting. Two adapter methods used to await those calls and inspect only
 * `data`, which produced a pair of silent lies that compounded:
 *
 *   * `signOut()` discarded a returned `{ error }`, so a revoke that failed
 *     still reported success -- identity teardown then recorded
 *     "credentials revoked" for a device that still held working tokens; and
 *   * `currentUserId()` mapped `{ user: null, error }` to `null`, so a lookup
 *     that FAILED was indistinguishable from "nobody is signed in" -- teardown
 *     read that as "no residual credential".
 *
 * Together they meant a surviving credential could be reported as fully cleaned.
 * These tests assert on the RETURNED SHAPES rather than only on promise
 * rejection, because a returned error is exactly what the old code ignored.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const h = vi.hoisted(() => ({
  getUser: undefined as never,
  getSession: undefined as never,
  signOut: undefined as never,
}));

vi.mock('./client', () => {
  h.getUser = vi.fn() as never;
  h.getSession = vi.fn() as never;
  h.signOut = vi.fn() as never;
  return {
    getSupabase: () => ({
      auth: { getUser: h.getUser, getSession: h.getSession, signOut: h.signOut },
    }),
  };
});

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn(async () => null),
    setItem: vi.fn(async () => undefined),
    removeItem: vi.fn(async () => undefined),
  },
}));

import { authRepoSupabase } from './auth';

const getUser = () => h.getUser as unknown as ReturnType<typeof vi.fn>;
const getSession = () => h.getSession as unknown as ReturnType<typeof vi.fn>;
const signOut = () => h.signOut as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => vi.clearAllMocks());

describe('signOut result contract', () => {
  it('THROWS on a returned error (the client does not reject)', async () => {
    signOut().mockResolvedValue({ error: { message: 'network down', status: 500 } });

    await expect(authRepoSupabase.signOut()).rejects.toBeTruthy();
  });

  it('resolves when the revoke genuinely succeeded', async () => {
    signOut().mockResolvedValue({ error: null });

    await expect(authRepoSupabase.signOut()).resolves.toBeUndefined();
  });
});

describe('currentUserId result contract', () => {
  it('THROWS when the lookup failed, rather than reporting "nobody signed in"', async () => {
    // The exact shape that used to be silently read as null.
    getUser().mockResolvedValue({
      data: { user: null },
      error: { message: 'Failed to fetch', status: 500 },
    });

    await expect(authRepoSupabase.currentUserId()).rejects.toBeTruthy();
  });

  it('returns null for a genuine "no session" error, which IS the answer', async () => {
    getUser().mockResolvedValue({
      data: { user: null },
      error: { name: 'AuthSessionMissingError', message: 'Auth session missing!' },
    });

    await expect(authRepoSupabase.currentUserId()).resolves.toBeNull();
  });

  it('returns the id when a user is present', async () => {
    getUser().mockResolvedValue({ data: { user: { id: 'u-1' } }, error: null });

    await expect(authRepoSupabase.currentUserId()).resolves.toBe('u-1');
  });
});

describe('hasLocalCredential fails closed', () => {
  it('reports TRUE when the session cannot be read (unknown is not absence)', async () => {
    getSession().mockResolvedValue({ data: { session: null }, error: { message: 'storage error' } });

    // Teardown uses this to decide whether a credential survived; claiming a
    // clean device when we cannot tell is the failure this prevents.
    await expect(authRepoSupabase.hasLocalCredential()).resolves.toBe(true);
  });

  it('reports TRUE while a session is still persisted', async () => {
    getSession().mockResolvedValue({ data: { session: { user: { id: 'u-1' } } }, error: null });

    await expect(authRepoSupabase.hasLocalCredential()).resolves.toBe(true);
  });

  it('reports FALSE only when the session is provably gone', async () => {
    getSession().mockResolvedValue({ data: { session: null }, error: null });

    await expect(authRepoSupabase.hasLocalCredential()).resolves.toBe(false);
  });

  it('does not require the network (uses getSession, not getUser)', async () => {
    getSession().mockResolvedValue({ data: { session: null }, error: null });

    await authRepoSupabase.hasLocalCredential();

    // getUser round-trips to the auth server and would fail offline -- exactly
    // when a failed sign-out most needs this answer.
    expect(getUser()).not.toHaveBeenCalled();
    expect(getSession()).toHaveBeenCalledTimes(1);
  });
});
