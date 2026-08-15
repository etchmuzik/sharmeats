export interface PushRevocationDependencies {
  inMemoryToken: string | null;
  readStoredToken: () => Promise<string | null>;
  deleteServerToken: (token: string) => Promise<boolean>;
  unregisterNative: () => Promise<boolean>;
  clearStoredToken: () => Promise<void>;
}

/** Revoke via the backend mapping or by invalidating the native registration. */
export async function revokePushIdentity(
  deps: PushRevocationDependencies,
): Promise<boolean> {
  let token = deps.inMemoryToken;
  // Distinguish "no token is bound to this device" (nothing to revoke) from
  // "could not read storage" (unknown, fail closed).
  let storedTokenKnown = true;
  if (!token) {
    try {
      token = await deps.readStoredToken();
    } catch {
      token = null;
      storedTokenKnown = false;
    }
  }

  if (!token && storedTokenKnown) {
    // This app never registered a token on this device (or already revoked
    // it), so no server mapping can leak to the next account. Native
    // unregistration stays best-effort; its failure is not a revocation gap.
    await deps.unregisterNative().catch(() => undefined);
    return true;
  }

  let serverRevoked = false;
  if (token) {
    try {
      serverRevoked = await deps.deleteServerToken(token);
    } catch {
      serverRevoked = false;
    }
  }

  let nativeRevoked = false;
  try {
    nativeRevoked = await deps.unregisterNative();
  } catch {
    nativeRevoked = false;
  }

  const revoked = serverRevoked || nativeRevoked;
  if (revoked) await deps.clearStoredToken().catch(() => undefined);
  return revoked;
}
