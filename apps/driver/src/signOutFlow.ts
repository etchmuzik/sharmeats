export type DriverCleanupStep = 'presence' | 'stream' | 'push';

export interface DriverSignOutDependencies {
  stopPresence: () => Promise<void>;
  stopStreaming: () => Promise<void>;
  unregisterPush: () => Promise<boolean>;
  signOut: () => Promise<void>;
}

export interface DriverSignOutResult {
  authSignedOut: boolean;
  pushRevoked: boolean;
  cleanupFailures: DriverCleanupStep[];
  authError?: unknown;
}

/**
 * Tear down a driver's device identity without allowing a best-effort cleanup
 * to prevent the authoritative Supabase sign-out from being attempted.
 */
export async function runDriverSignOut(
  deps: DriverSignOutDependencies,
): Promise<DriverSignOutResult> {
  const cleanupFailures: DriverCleanupStep[] = [];

  try {
    await deps.stopPresence();
  } catch {
    cleanupFailures.push('presence');
  }

  try {
    await deps.stopStreaming();
  } catch {
    cleanupFailures.push('stream');
  }

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
