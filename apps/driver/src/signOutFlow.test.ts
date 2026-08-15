import { describe, expect, it, vi } from 'vitest';
import { runDriverSignOut } from './signOutFlow';

describe('runDriverSignOut', () => {
  it('attempts every cleanup and still revokes auth when cleanup fails', async () => {
    const calls: string[] = [];
    const stopPresence = vi.fn(async () => {
      calls.push('presence');
      throw new Error('location unavailable');
    });
    const stopStreaming = vi.fn(async () => {
      calls.push('stream');
      throw new Error('task manager unavailable');
    });
    const unregisterPush = vi.fn(async () => {
      calls.push('push');
      return false;
    });
    const signOut = vi.fn(async () => {
      calls.push('auth');
    });

    const result = await runDriverSignOut({
      stopPresence,
      stopStreaming,
      unregisterPush,
      signOut,
    });

    expect(calls).toEqual(['presence', 'stream', 'push', 'auth']);
    expect(result.authSignedOut).toBe(true);
    expect(result.pushRevoked).toBe(false);
    expect(result.cleanupFailures).toEqual(['presence', 'stream']);
  });

  it('reports a failed credential revocation instead of navigating as signed out', async () => {
    const result = await runDriverSignOut({
      stopPresence: vi.fn(async () => {}),
      stopStreaming: vi.fn(async () => {}),
      unregisterPush: vi.fn(async () => true),
      signOut: vi.fn(async () => {
        throw new Error('network down');
      }),
    });

    expect(result).toMatchObject({
      authSignedOut: false,
      pushRevoked: true,
      cleanupFailures: [],
    });
    expect(result.authError).toBeInstanceOf(Error);
  });
});
