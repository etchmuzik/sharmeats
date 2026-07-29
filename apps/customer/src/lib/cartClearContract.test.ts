/**
 * Which clear does each call site use? (Package 02 Slice D)
 *
 * There are two clears and choosing the wrong one is silent in both directions:
 *
 *   clear()           local only. Sign-out / identity teardown MUST use this,
 *                     because an account's saved basket has to survive being
 *                     handed a different person's session. If teardown ever
 *                     called clearEverywhere, lending your phone to a friend
 *                     would delete your basket on every device you own.
 *
 *   clearEverywhere() local + retires the server row. The two genuinely-finished
 *                     cases — a confirmed placement, and an explicit "empty" tap
 *                     — MUST use this, or the basket the customer just cleared
 *                     comes back from another device.
 *
 * Neither mistake throws or fails a typecheck: both functions exist and both
 * "work". Only the CHOICE distinguishes them.
 *
 * This asserts the teardown half behaviourally — teardown is a plain async
 * function, so it can be run against a spied store and observed. The two screen
 * call sites are React components whose buttons would need a full render tree to
 * press, so they are covered by the store-level tests in store/cart.test.ts
 * (which prove the two clears differ) plus the comments at each site. The
 * teardown direction is the one worth a hard test: it is the only one whose
 * failure silently destroys data the customer never asked to delete.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({ calls: [] as string[] }));

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn(async () => null),
    setItem: vi.fn(async () => {}),
    removeItem: vi.fn(async (k: string) => {
      h.calls.push(`removeItem:${k}`);
    }),
  },
}));

vi.mock('../data', () => ({
  isBackendLive: true,
  db: {
    auth: {
      signOut: vi.fn(async () => {
        h.calls.push('auth.signOut');
      }),
      ensureSession: vi.fn(async () => ({ userId: 'anon', isAnonymous: true })),
      hasLocalCredential: vi.fn(async () => false),
    },
    cart: {
      get: vi.fn(async () => null),
      upsert: vi.fn(async () => ({ ok: true, version: 1, updatedAt: '', expiresAt: '' })),
      // The tripwire: teardown must never reach this.
      clear: vi.fn(async () => {
        h.calls.push('SERVER_CART_DELETED');
      }),
    },
  },
}));

vi.mock('./analytics', () => ({ resetAnalyticsUser: vi.fn(), track: vi.fn() }));
vi.mock('./push', () => ({ unregisterPush: vi.fn(async () => {}) }));
// The session store reaches deviceLocale -> react-native, which Vitest cannot
// parse. Same mock the existing identityTeardown test uses.
vi.mock('./deviceLocale', () => ({ detectDeviceLanguage: () => 'en' }));

import { transitionIdentity } from './identityTeardown';
import { useCart } from '../store/cart';

describe('sign-out keeps the account cart on the server', () => {
  beforeEach(() => {
    h.calls.length = 0;
    useCart.setState({
      restaurantId: 'r1',
      restaurantName: 'Test',
      lines: [
        {
          lineId: 'l1',
          itemId: 'i1',
          restaurantId: 'r1',
          name: 'X',
          basePriceEgp: 10,
          image: '',
          quantity: 1,
          modifierChoices: [],
        },
      ],
      serverVersion: 3,
    });
  });

  it('empties the LOCAL basket', async () => {
    await transitionIdentity();
    expect(useCart.getState().lines).toEqual([]);
    expect(useCart.getState().restaurantId).toBeNull();
  });

  it('NEVER deletes the server cart — the next sign-in must find it', async () => {
    await transitionIdentity();
    // If this fires, handing your phone to a friend wiped your basket on every
    // device you own.
    expect(h.calls).not.toContain('SERVER_CART_DELETED');
  });

  it('still purges the local cart bytes (the privacy half)', async () => {
    await transitionIdentity();
    expect(h.calls).toContain('removeItem:@sharmeats:cart:v1');
  });
});

describe('the store exposes both clears as distinct operations', () => {
  it('clear is local-only and clearEverywhere is async', () => {
    const s = useCart.getState();
    // A sync return means it cannot be awaiting a server call; clearEverywhere
    // returns a promise precisely because it does.
    expect(s.clear()).toBeUndefined();
    expect(s.clearEverywhere()).toBeInstanceOf(Promise);
  });
});
