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
export function captureError(error: unknown, context?: Record<string, unknown>): void {
  if (!SENTRY_DSN) return;
  Sentry.captureException(error, context ? { extra: context } : undefined);
}
