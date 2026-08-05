/**
 * Crash reporting (Sentry) for the driver app.
 *
 * Opt-in via env so mock/dev stays clean:
 *   EXPO_PUBLIC_SENTRY_DSN — enables Sentry crash reporting
 *
 * The driver app runs unattended for hours on a courier's phone mid-delivery,
 * so an uncaught crash that goes unreported is the worst blind spot we have.
 * When the DSN is absent every call is a silent no-op; a *release* build that
 * boots without it warns loudly (below) rather than shipping dark.
 *
 * Mirrors apps/customer/src/lib/analytics.ts (minus PostHog — the driver app is
 * an operational tool, not a product-analytics surface).
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
  // means the driver app ships with no crash reports. Set EXPO_PUBLIC_SENTRY_DSN
  // in the EAS `production` profile (or as an EAS secret) to light it up.
  if (!__DEV__ && !SENTRY_DSN) {
    console.warn(
      '[crash] Release build booted WITHOUT EXPO_PUBLIC_SENTRY_DSN. ' +
        'Crash reporting is DISABLED. Set it in the EAS production profile.',
    );
  }
}

/** Tie crashes to the signed-in driver. */
export function identifyDriver(userId: string): void {
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
 * Telemetry is a third-party boundary, not an error console. Backend failures
 * can echo a phone number, address, delivery note, or credential, so raw
 * messages, stacks, `details`, and `hint` must never cross it. We keep only a
 * bounded error name/code for useful grouping.
 */
export function normaliseError(error: unknown): {
  error: Error;
  extra?: Record<string, unknown>;
} {
  const rec = error !== null && typeof error === 'object' ? (error as Record<string, unknown>) : null;
  const code = safeErrorCode(rec?.code);
  const isPostgrestError = !!rec && 'details' in rec && 'hint' in rec;
  const name = isPostgrestError && code
    ? `PostgrestError ${code}`
    : error instanceof Error
      ? safeErrorName(error.name)
      : 'Error';

  const normalised = new Error('Operation failed');
  normalised.name = name;
  // Do not copy source.stack: its first line normally contains the raw message.
  // A fresh Error gives Sentry the capture site without reproducing user input.
  return code ? { error: normalised, extra: { code } } : { error: normalised };
}

const SAFE_ERROR_CODE = /^[A-Za-z0-9_.:-]{1,64}$/;
const SAFE_ERROR_NAME = /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/;
const BANNED_CONTEXT_PROPERTY_FRAGMENTS = [
  'phone', 'email', 'address', 'room', 'note', 'token', 'password', 'message',
  'support_text', 'lat', 'lng', 'coordinate', 'detail', 'hint', 'stack',
] as const;

function safeErrorCode(value: unknown): string | null {
  return typeof value === 'string' && SAFE_ERROR_CODE.test(value) ? value : null;
}

function safeErrorName(value: unknown): string {
  return typeof value === 'string' && SAFE_ERROR_NAME.test(value) ? value : 'Error';
}

function telemetryContext(context?: Record<string, unknown>): Record<string, string | number | boolean | null> {
  const clean: Record<string, string | number | boolean | null> = {};
  for (const [key, value] of Object.entries(context ?? {})) {
    const lowerKey = key.toLowerCase();
    if (BANNED_CONTEXT_PROPERTY_FRAGMENTS.some((fragment) => lowerKey.includes(fragment))) continue;
    if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      clean[key] = value;
    }
  }
  return clean;
}

function isDev(): boolean {
  return typeof __DEV__ !== 'undefined' && __DEV__;
}

export function captureError(error: unknown, context?: Record<string, unknown>): void {
  const { error: normalised, extra } = normaliseError(error);
  const merged = { ...extra, ...telemetryContext(context) };
  const hasExtra = Object.keys(merged).length > 0;

  if (SENTRY_DSN) Sentry.captureException(normalised, hasExtra ? { extra: merged } : undefined);
  else if (isDev()) console.warn('[crash] error (Sentry off):', normalised.message, merged);
}
