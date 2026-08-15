import { describe, expect, it, vi } from 'vitest';
import { runRestaurantSignOut } from './signOutFlow';

describe('runRestaurantSignOut', () => {
  it('still revokes auth when push cleanup fails', async () => {
    const calls: string[] = [];
    const result = await runRestaurantSignOut({
      unregisterPush: vi.fn(async () => {
        calls.push('push');
        throw new Error('storage unavailable');
      }),
      signOut: vi.fn(async () => {
        calls.push('auth');
      }),
    });

    expect(calls).toEqual(['push', 'auth']);
    expect(result.authSignedOut).toBe(true);
    expect(result.pushRevoked).toBe(false);
    expect(result.cleanupFailures).toEqual(['push']);
  });

  it('reports a failed credential revocation', async () => {
    const result = await runRestaurantSignOut({
      unregisterPush: vi.fn(async () => true),
      signOut: vi.fn(async () => {
        throw new Error('network down');
      }),
    });

    expect(result.authSignedOut).toBe(false);
    expect(result.authError).toBeInstanceOf(Error);
  });
});
