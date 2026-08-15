import { describe, expect, it, vi } from 'vitest';
import { revokePushIdentity } from './pushTokenLifecycle';

describe('revokePushIdentity', () => {
  it('deletes a token restored after a process restart', async () => {
    const deleteServerToken = vi.fn(async () => true);
    const revoked = await revokePushIdentity({
      inMemoryToken: null,
      readStoredToken: async () => 'ExponentPushToken[kiosk]',
      deleteServerToken,
      unregisterNative: async () => false,
      clearStoredToken: async () => {},
    });

    expect(deleteServerToken).toHaveBeenCalledWith('ExponentPushToken[kiosk]');
    expect(revoked).toBe(true);
  });

  it('retains durable state when server and native revocation both fail', async () => {
    const clearStoredToken = vi.fn(async () => {});
    const revoked = await revokePushIdentity({
      inMemoryToken: 'ExponentPushToken[kiosk]',
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
