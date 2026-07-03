/**
 * Crash reporting (Sentry) for the restaurant app.
 *
 * Opt-in via env so mock/dev stays clean:
 *   EXPO_PUBLIC_SENTRY_DSN — enables Sentry crash reporting
 *
 * The restaurant app runs as a kitchen kiosk for whole shifts; an uncaught
 * crash that drops the order queue must not go unreported. When the DSN is
 * absent every call is a silent no-op; a *release* build that boots without it
 * warns loudly (below) rather than shipping dark.
 *
 * Mirrors apps/customer/src/lib/analytics.ts (minus PostHog — the restaurant
 * app is an operational tool, not a product-analytics surface).
 */
import * as Sentry from '@sentry/react-native';

const SENTRY_DSN = process.env.EXPO_PUBLIC_SENTRY_DSN;
let initialized = false;

export function initCrashReporting(): void {
  if (initialized) return;
  initialized = true;

  if (SENTRY_DSN) {
    Sentry.init({
      dsn: SENTRY_DSN,
      tracesSampleRate: 0.2,
      enableNativeFramesTracking: false,
    });
  }

  // Make the "silently disabled in prod" trap loud: a release build with no DSN
  // means the restaurant app ships with no crash reports. Set
  // EXPO_PUBLIC_SENTRY_DSN in the EAS `production` profile (or as an EAS secret).
  if (!__DEV__ && !SENTRY_DSN) {
    console.warn(
      '[crash] Release build booted WITHOUT EXPO_PUBLIC_SENTRY_DSN. ' +
        'Crash reporting is DISABLED. Set it in the EAS production profile.',
    );
  }
}

/** Tie crashes to the signed-in restaurant staffer. */
export function identifyStaff(userId: string): void {
  if (SENTRY_DSN) Sentry.setUser({ id: userId });
}

export function resetCrashUser(): void {
  if (SENTRY_DSN) Sentry.setUser(null);
}

/** Report a caught error that would otherwise be swallowed. */
export function captureError(error: unknown, context?: Record<string, unknown>): void {
  if (SENTRY_DSN) Sentry.captureException(error, context ? { extra: context } : undefined);
  else if (__DEV__) console.warn('[crash] error (Sentry off):', error);
}
