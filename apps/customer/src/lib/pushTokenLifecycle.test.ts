import { describe, expect, it, vi } from 'vitest';
import { revokePushIdentity } from './pushTokenLifecycle';

describe('revokePushIdentity', () => {
  it('uses the persisted token when the in-memory cache was lost', async () => {
    const deleteServerToken = vi.fn(async () => true);
    const revoked = await revokePushIdentity({
      inMemoryToken: null,
      readStoredToken: async () => 'ExponentPushToken[customer]',
      deleteServerToken,
      unregisterNative: async () => false,
      clearStoredToken: async () => {},
    });

    expect(deleteServerToken).toHaveBeenCalledWith('ExponentPushToken[customer]');
    expect(revoked).toBe(true);
  });

  it('fails closed when neither the backend nor the native service confirms revocation', async () => {
    const clearStoredToken = vi.fn(async () => {});
    const revoked = await revokePushIdentity({
      inMemoryToken: null,
      readStoredToken: async () => {
        throw new Error('storage unavailable');
      },
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
