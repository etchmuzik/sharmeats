/**
 * Analytics + crash reporting (PostHog + Sentry).
 *
 * Both are OPT-IN via env so mock-mode demos and local dev stay clean:
 *   EXPO_PUBLIC_SENTRY_DSN       — enables Sentry crash reporting
 *   EXPO_PUBLIC_POSTHOG_API_KEY  — enables PostHog product analytics
 *   EXPO_PUBLIC_POSTHOG_HOST     — optional, defaults to the EU cloud
 *
 * When a key is absent every call below is a silent no-op, so call sites never
 * need to guard. Keep event names snake_case and stable — they become the
 * analytics vocabulary.
 */
import * as Sentry from '@sentry/react-native';
import PostHog from 'posthog-react-native';

const SENTRY_DSN = process.env.EXPO_PUBLIC_SENTRY_DSN;
const POSTHOG_KEY = process.env.EXPO_PUBLIC_POSTHOG_API_KEY;
const POSTHOG_HOST = process.env.EXPO_PUBLIC_POSTHOG_HOST ?? 'https://eu.i.posthog.com';

let posthog: PostHog | null = null;
let initialized = false;

export function initAnalytics(): void {
  if (initialized) return;
  initialized = true;
  if (SENTRY_DSN) {
    Sentry.init({
      dsn: SENTRY_DSN,
      tracesSampleRate: 0.2,
      enableNativeFramesTracking: false,
    });
  }
  if (POSTHOG_KEY) {
    posthog = new PostHog(POSTHOG_KEY, { host: POSTHOG_HOST });
  }
}

export type AnalyticsEvent =
  | 'restaurant_viewed'
  | 'checkout_opened'
  | 'order_placed'
  | 'order_cancelled'
  | 'promo_applied'
  | 'promo_rejected'
  | 'favorite_toggled'
  | 'reorder_tapped'
  | 'cross_sell_added'
  | 'push_permission'
  | 'search_performed';

export function track(
  event: AnalyticsEvent,
  props?: Record<string, string | number | boolean | null | undefined>,
): void {
  if (!posthog) return;
  // PostHog's property type rejects `undefined` values — drop them.
  const clean: Record<string, string | number | boolean | null> = {};
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (v !== undefined) clean[k] = v;
    }
  }
  posthog.capture(event, clean);
}

/** Tie events + crashes to the signed-in user (anonymous ids stay device-scoped). */
export function identifyUser(userId: string): void {
  posthog?.identify(userId);
  if (SENTRY_DSN) Sentry.setUser({ id: userId });
}

export function resetAnalyticsUser(): void {
  posthog?.reset();
  if (SENTRY_DSN) Sentry.setUser(null);
}

export function captureError(error: unknown, context?: Record<string, unknown>): void {
  if (SENTRY_DSN) Sentry.captureException(error, context ? { extra: context } : undefined);
  else if (__DEV__) console.warn('[analytics] error (Sentry off):', error);
}
