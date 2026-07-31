/**
 * Client-side Sentry crash reporting for the ops/admin dashboard.
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
  if (!SENTRY_DSN) return;
  const { error: normalised, extra } = normaliseError(error);
  // context wins on collision: the call site knows more than the payload does.
  const merged = { ...extra, ...context };
  Sentry.captureException(normalised, Object.keys(merged).length > 0 ? { extra: merged } : undefined);
}
