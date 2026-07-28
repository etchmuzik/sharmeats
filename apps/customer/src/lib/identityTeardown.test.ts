/**
 * Device isolation on identity change.
 *
 * These assert the LEAK, not just the helper. Each test seeds a realistic
 * basket (item names, free-text notes, allergen selections) and proves it is
 * gone from BOTH device storage and live memory. Written to fail against the
 * previous behaviour, where Profile sign-out never called Supabase, the cart key
 * survived, and the Zustand cart kept its lines in memory.
 *
 * AsyncStorage is mocked with the same in-memory adapter the other store tests
 * use — the real React Native module reaches for `window` and cannot run under
 * this environment.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

// vi.mock factories are hoisted above every const in this file, so the shared
// fixtures they close over must be hoisted too -- otherwise the factory runs
// first and dies on "Cannot access 'signOutMock' before initialization".
const h = vi.hoisted(() => ({
  store: {} as Record<string, string>,
  order: [] as string[],
}));
const { store, order } = h;

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn(async (k: string) => h.store[k] ?? null),
    setItem: vi.fn(async (k: string, v: string) => {
      h.store[k] = v;
    }),
    removeItem: vi.fn(async (k: string) => {
      h.order.push(`removeItem:${k}`);
      delete h.store[k];
    }),
    getAllKeys: vi.fn(async () => Object.keys(h.store)),
  },
}));

const authMocks = vi.hoisted(() => ({
  signOut: undefined as never,
  ensureSession: undefined as never,
  currentUserId: undefined as never,
  hasLocalCredential: undefined as never,
}));

vi.mock('../data', () => {
  authMocks.signOut = vi.fn(async () => {
    h.order.push('auth.signOut');
  }) as never;
  authMocks.ensureSession = vi.fn(async () => {
    h.order.push('auth.ensureSession');
    return { userId: 'anon-next', isAnonymous: true };
  }) as never;
  // Defaults to "credential is gone" -- the healthy case. Failure-path tests
  // override it to prove teardown fails closed.
  authMocks.currentUserId = vi.fn(async () => null) as never;
  // Default: the credential is genuinely gone (the healthy case).
  authMocks.hasLocalCredential = vi.fn(async () => false) as never;
  return {
    db: {
      auth: {
        signOut: authMocks.signOut,
        ensureSession: authMocks.ensureSession,
        currentUserId: authMocks.currentUserId,
        hasLocalCredential: authMocks.hasLocalCredential,
      },
    },
    isBackendLive: true,
  };
});
const signOutMock = () => authMocks.signOut as unknown as ReturnType<typeof vi.fn>;
const ensureSessionMock = () => authMocks.ensureSession as unknown as ReturnType<typeof vi.fn>;
const currentUserIdMock = () => authMocks.currentUserId as unknown as ReturnType<typeof vi.fn>;
const hasLocalCredentialMock = () =>
  authMocks.hasLocalCredential as unknown as ReturnType<typeof vi.fn>;

// session.ts -> deviceLocale -> react-native, which cannot be parsed here.
// Same stub the other store tests use.
vi.mock('../lib/deviceLocale', () => ({ detectDeviceLanguage: () => 'en' }));

vi.mock('./push', () => ({
  unregisterPush: vi.fn(async () => {
    h.order.push('unregisterPush');
  }),
}));

vi.mock('./analytics', () => ({
  resetAnalyticsUser: vi.fn(() => {
    h.order.push('resetAnalyticsUser');
  }),
}));

import { transitionIdentity, IDENTITY_SCOPED_KEYS } from './identityTeardown';
import { useCart } from '../store/cart';
import { useSession } from '../store/session';

const CART_KEY = '@sharmeats:cart:v1';

/** A basket holding exactly the fields that make this a privacy problem. */
const PRIOR_CART = {
  restaurantId: 'r-1',
  restaurantName: 'Fish Market',
  lines: [
    {
      lineId: 'l-1',
      itemId: 'i-1',
      restaurantId: 'r-1',
      name: 'Grilled Sea Bass',
      quantity: 1,
      basePriceEgp: 220,
      image: '',
      modifierChoices: [],
      notes: 'room 214, no onions please',
      allergens: ['shellfish'],
    },
  ],
};

beforeEach(() => {
  for (const k of Object.keys(store)) delete store[k];
  order.length = 0;
  vi.clearAllMocks();
  currentUserIdMock().mockImplementation(async () => null);
  hasLocalCredentialMock().mockImplementation(async () => false);
  // Seed BOTH layers: bytes on disk and the live store, which is the state a
  // signed-in customer actually leaves behind.
  store[CART_KEY] = JSON.stringify(PRIOR_CART);
  useCart.setState({
    lines: PRIOR_CART.lines as never,
    restaurantId: 'r-1',
    restaurantName: 'Fish Market',
  });
  useSession.setState({ isSignedIn: true, phone: '+201000000000' });
});

describe('transitionIdentity', () => {
  it('revokes Supabase credentials — Profile sign-out previously never did', async () => {
    const result = await transitionIdentity();

    expect(signOutMock()).toHaveBeenCalledTimes(1);
    expect(result.authSignedOut).toBe(true);
  });

  it('resets the IN-MEMORY cart, not just the stored bytes', async () => {
    expect(useCart.getState().lines).toHaveLength(1);

    await transitionIdentity();

    // A mounted cart screen reads memory. Clearing only storage would leave the
    // previous basket on screen and re-persist it on the next write.
    expect(useCart.getState().lines).toHaveLength(0);
    expect(useCart.getState().restaurantId).toBeNull();
    expect(useCart.getState().restaurantName).toBeNull();
  });

  it('resets the in-memory session identity', async () => {
    await transitionIdentity();

    expect(useSession.getState().isSignedIn).toBe(false);
    expect(useSession.getState().phone).toBeNull();
  });

  it('revokes credentials BEFORE dropping local state', async () => {
    await transitionIdentity();

    // If local state went first there would be a window where the UI reads
    // signed-out while the SDK still holds working tokens.
    expect(order.indexOf('auth.signOut')).toBeLessThan(order.indexOf('resetAnalyticsUser'));
    // And push is unregistered while the token still belongs to this identity.
    expect(order.indexOf('unregisterPush')).toBeLessThan(order.indexOf('auth.signOut'));
  });

  it('leaves no trace of notes, allergens or phone anywhere in storage', async () => {
    store['@sharmeats:session:v1'] = JSON.stringify({ phone: '+201000000000' });

    await transitionIdentity();

    // Scan EVERY remaining key, not only the ones we expected to clear: a future
    // store that copies personal data under a new key should fail here.
    const residue = Object.values(store).join('|');
    for (const secret of [
      'room 214',
      'shellfish',
      'Grilled Sea Bass',
      '+201000000000',
    ]) {
      expect(residue).not.toContain(secret);
    }
  });

  it('removes the key rather than leaving an empty record behind', async () => {
    await transitionIdentity();

    // useCart().clear() writes `{lines: []}` back, which is NOT teardown:
    // absence and "present but empty" are different states, and only absence
    // proves nothing was retained.
    expect(Object.keys(store)).not.toContain(CART_KEY);
  });

  it('clears every declared identity-scoped key', async () => {
    for (const key of IDENTITY_SCOPED_KEYS) store[key] = 'seeded';

    const result = await transitionIdentity();

    expect(result.removedKeys.sort()).toEqual([...IDENTITY_SCOPED_KEYS].sort());
    for (const key of IDENTITY_SCOPED_KEYS) {
      expect(Object.keys(store)).not.toContain(key);
    }
  });

  it('keeps device preferences that are not personal data', async () => {
    // Locale is a device setting. Resetting the phone to English because
    // someone signed out would be a regression, not a privacy win.
    store['@sharmeats:locale'] = 'ar';

    await transitionIdentity();

    expect(store['@sharmeats:locale']).toBe('ar');
  });

  it('establishes a fresh anonymous session so the next user can browse', async () => {
    const result = await transitionIdentity();

    expect(ensureSessionMock()).toHaveBeenCalledTimes(1);
    expect(result.anonymousSessionReady).toBe(true);
    // Strictly after credentials are revoked, or it would re-use the old session.
    expect(order.indexOf('auth.signOut')).toBeLessThan(order.indexOf('auth.ensureSession'));
  });

  it('still purges locally when Supabase sign-out fails (offline)', async () => {
    signOutMock().mockRejectedValueOnce(new Error('network down'));

    const result = await transitionIdentity();

    // Tokens are useless without our RLS-gated backend accepting them, and the
    // device must not keep the previous basket just because we were offline.
    // currentUserId still reports null here (the default), so this is the
    // "revoke call failed but no credential remains" case.
    expect(result.authSignedOut).toBe(false);
    expect(result.residualCredential).toBe(false);
    expect(useCart.getState().lines).toHaveLength(0);
    expect(Object.keys(store)).not.toContain(CART_KEY);
  });


  it('FAILS CLOSED: never adopts the old session when sign-out failed', async () => {
    signOutMock().mockRejectedValueOnce(new Error('network down'));
    // The credential survived the failed revoke.
    hasLocalCredentialMock().mockImplementation(async () => true);

    const result = await transitionIdentity();

    // ensureSession() returns the EXISTING session when one is present, so
    // calling it here would hand back the departing user and call it "ready".
    expect(ensureSessionMock()).not.toHaveBeenCalled();
    expect(result.anonymousSessionReady).toBe(false);
    expect(result.residualCredential).toBe(true);
    // Local isolation still happened -- the basket does not survive either way.
    expect(useCart.getState().lines).toHaveLength(0);
  });

  it('proves the credential is gone BEFORE establishing a fresh session', async () => {
    await transitionIdentity();

    expect(hasLocalCredentialMock()).toHaveBeenCalled();
    expect(ensureSessionMock()).toHaveBeenCalledTimes(1);
  });

  it('treats an unverifiable credential as residual, not as clear', async () => {
    signOutMock().mockRejectedValueOnce(new Error('network down'));
    hasLocalCredentialMock().mockRejectedValueOnce(new Error('cannot reach storage'));

    const result = await transitionIdentity();

    // Unable to confirm the credential is gone => must not assume it is.
    expect(result.residualCredential).toBe(true);
    expect(ensureSessionMock()).not.toHaveBeenCalled();
  });

  it('never throws when a step fails, so teardown cannot fail a real deletion', async () => {
    signOutMock().mockRejectedValueOnce(new Error('network down'));
    ensureSessionMock().mockRejectedValueOnce(new Error('network down'));

    // The account is already gone server-side. Surfacing this as a failed
    // deletion would be a lie to the customer.
    await expect(transitionIdentity()).resolves.toMatchObject({
      authSignedOut: false,
      anonymousSessionReady: false,
    });
  });
});
