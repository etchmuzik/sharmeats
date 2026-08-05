/**
 * Client-side Sentry crash reporting for the merchant dashboard.
 *
 * This is a STATIC-EXPORT SPA (`output: 'export'`, no server runtime), so we
 * only ever run the browser SDK — no `instrumentation.ts`, no tunnel route, no
 * `withSentryConfig` wrapping of next.config. `@sentry/nextjs` re-exports the
 * browser SDK, so `Sentry.init` / `Sentry.captureException` work purely
 * client-side.
 *
 * Reporting is OPT-IN via env, mirroring the mobile apps
 * (apps/customer/src/lib/analytics.ts): when NEXT_PUBLIC_SENTRY_DSN is absent
 * every export below is a silent no-op, so the app builds and boots fine with
 * no DSN and call sites never need to guard.
 */
import * as Sentry from '@sentry/nextjs';

const SENTRY_DSN = process.env.NEXT_PUBLIC_SENTRY_DSN;

let initialized = false;

/** Initialise Sentry once on the client. No-op when the DSN is unset. */
export function initSentry(): void {
  if (initialized) return;
  initialized = true;
  if (!SENTRY_DSN) return;

  Sentry.init({
    dsn: SENTRY_DSN,
    environment: process.env.NODE_ENV,
    tracesSampleRate: 0.2,
  });
}

/** Report an error to Sentry. No-op when the DSN is unset. */
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

export function captureError(error: unknown, context?: Record<string, unknown>): void {
  if (!SENTRY_DSN) return;
  const { error: normalised, extra } = normaliseError(error);
  const merged = { ...extra, ...telemetryContext(context) };
  Sentry.captureException(normalised, Object.keys(merged).length > 0 ? { extra: merged } : undefined);
}
