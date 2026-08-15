export interface RestaurantSignOutDependencies {
  unregisterPush: () => Promise<boolean>;
  signOut: () => Promise<void>;
}

export interface RestaurantSignOutResult {
  authSignedOut: boolean;
  pushRevoked: boolean;
  cleanupFailures: Array<'push'>;
  authError?: unknown;
}

/** Always attempts credential revocation, even if device-token cleanup fails. */
export async function runRestaurantSignOut(
  deps: RestaurantSignOutDependencies,
): Promise<RestaurantSignOutResult> {
  const cleanupFailures: Array<'push'> = [];
  let pushRevoked = false;

  try {
    pushRevoked = await deps.unregisterPush();
  } catch {
    cleanupFailures.push('push');
  }

  try {
    await deps.signOut();
    return { authSignedOut: true, pushRevoked, cleanupFailures };
  } catch (authError) {
    return {
      authSignedOut: false,
      pushRevoked,
      cleanupFailures,
      authError,
    };
  }
}
