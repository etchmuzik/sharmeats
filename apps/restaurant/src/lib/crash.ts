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
/**
 * Sentry only understands Error instances. Hand it anything else and it stores
 * "Object captured as exception with keys: code, details, hint, message" — the
 * KEY NAMES, not the values — so the actual message is discarded and every
 * unrelated failure with that shape groups into a single issue.
 *
 * That shape is Supabase's PostgrestError, a plain object rather than an Error.
 * Observed in production 2026-07-31 via the customer app; every surface here
 * calls supabase-js, so every surface had it.
 *
 * Errors pass through untouched so a real stack and type survive. Everything
 * else is wrapped in an Error carrying the message, with the original fields
 * kept as `extra` rather than dropped.
 */
export function normaliseError(error: unknown): {
  error: Error;
  extra?: Record<string, unknown>;
} {
  if (error instanceof Error) return { error };
  if (typeof error === 'string') return { error: new Error(error) };

  if (error !== null && typeof error === 'object') {
    const rec = error as Record<string, unknown>;
    const message =
      typeof rec.message === 'string' && rec.message ? rec.message : safeStringify(error);
    const wrapped = new Error(message);

    // PostgrestError is {code, details, hint, message}. Postgres/PostgREST codes
    // are a bounded set, so folding the code into the name gives Sentry a stable
    // grouping key per KIND of failure — the point of the fix. Matched on shape,
    // not on `code` alone, so an unrelated object carrying a code is not
    // mislabelled.
    if (typeof rec.code === 'string' && rec.code && 'details' in rec && 'hint' in rec) {
      wrapped.name = `PostgrestError ${rec.code}`;
    }
    return { error: wrapped, extra: rec };
  }

  return { error: new Error(String(error)) };
}

/** JSON.stringify throws on circular references; a logger must never throw. */
function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

export function captureError(error: unknown, context?: Record<string, unknown>): void {
  const { error: normalised, extra } = normaliseError(error);
  // context wins on collision: the call site knows more than the payload does.
  const merged = { ...extra, ...context };
  const hasExtra = Object.keys(merged).length > 0;

  if (SENTRY_DSN) Sentry.captureException(normalised, hasExtra ? { extra: merged } : undefined);
  else if (__DEV__) console.warn('[crash] error (Sentry off):', normalised.message, merged);
}
