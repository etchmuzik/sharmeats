import { describe, expect, it, vi } from 'vitest';
import { revokePushIdentity } from './pushTokenLifecycle';

describe('revokePushIdentity', () => {
  it('recovers the token from durable storage after a cold start', async () => {
    const deleteServerToken = vi.fn(async () => true);
    const clearStoredToken = vi.fn(async () => {});

    const revoked = await revokePushIdentity({
      inMemoryToken: null,
      readStoredToken: async () => 'ExponentPushToken[cold-start]',
      deleteServerToken,
      unregisterNative: async () => false,
      clearStoredToken,
    });

    expect(deleteServerToken).toHaveBeenCalledWith('ExponentPushToken[cold-start]');
    expect(clearStoredToken).toHaveBeenCalledTimes(1);
    expect(revoked).toBe(true);
  });

  it('uses native invalidation when the server delete fails', async () => {
    const revoked = await revokePushIdentity({
      inMemoryToken: 'ExponentPushToken[current]',
      readStoredToken: async () => null,
      deleteServerToken: async () => false,
      unregisterNative: async () => true,
      clearStoredToken: async () => {},
    });

    expect(revoked).toBe(true);
  });

  it('fails closed and retains the token when neither revocation path succeeds', async () => {
    const clearStoredToken = vi.fn(async () => {});
    const revoked = await revokePushIdentity({
      inMemoryToken: 'ExponentPushToken[current]',
      readStoredToken: async () => null,
      deleteServerToken: async () => false,
      unregisterNative: async () => false,
      clearStoredToken,
    });

    expect(revoked).toBe(false);
    expect(clearStoredToken).not.toHaveBeenCalled();
  });

  it('treats a device that never registered a token as already revoked', async () => {
    // Offline sign-out with no push identity bound must not report a revocation
    // gap: there is no server mapping to leak. Native unregistration is still
    // attempted, best-effort.
    const unregisterNative = vi.fn(async () => {
      throw new Error('FCM: SERVICE_NOT_AVAILABLE');
    });
    const deleteServerToken = vi.fn(async () => false);
    const revoked = await revokePushIdentity({
      inMemoryToken: null,
      readStoredToken: async () => null,
      deleteServerToken,
      unregisterNative,
      clearStoredToken: async () => {},
    });

    expect(revoked).toBe(true);
    expect(unregisterNative).toHaveBeenCalledTimes(1);
    expect(deleteServerToken).not.toHaveBeenCalled();
  });
});
