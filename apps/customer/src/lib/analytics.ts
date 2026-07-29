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
import { getReleaseInfo, releaseProperties } from './release';

const SENTRY_DSN = process.env.EXPO_PUBLIC_SENTRY_DSN;
const POSTHOG_KEY = process.env.EXPO_PUBLIC_POSTHOG_API_KEY;
const POSTHOG_HOST = process.env.EXPO_PUBLIC_POSTHOG_HOST ?? 'https://eu.i.posthog.com';

let posthog: PostHog | null = null;
let initialized = false;

export function initAnalytics(): void {
  if (initialized) return;
  initialized = true;
  const release = getReleaseInfo();

  if (SENTRY_DSN) {
    Sentry.init({
      dsn: SENTRY_DSN,
      tracesSampleRate: 0.2,
      enableNativeFramesTracking: false,
      // Package 01 §3: a stack trace is far less useful when you cannot tell
      // WHICH build produced it. `dist` distinguishes two devices on the same
      // binary running different OTA JS.
      ...(release.version ? { release: `sharmeats-customer@${release.version}` } : {}),
      ...(release.buildNumber ? { dist: release.buildNumber } : {}),
    });
    Sentry.setContext('release', releaseProperties(release));
  }
  if (POSTHOG_KEY) {
    posthog = new PostHog(POSTHOG_KEY, { host: POSTHOG_HOST });
  }

  // [M4] Make the "silently disabled in prod" trap loud. Opt-in-by-env is the
  // right posture for mock/dev, but a *release* build with no DSN/key means we
  // ship blind — no crash reports, no analytics — and nothing surfaced that.
  // We can't hardcode secrets here, so instead we warn unmistakably whenever a
  // non-dev build boots without them. Set EXPO_PUBLIC_SENTRY_DSN and
  // EXPO_PUBLIC_POSTHOG_API_KEY in the EAS `production` profile (or as EAS
  // secrets) to light them up.
  const isRelease = !__DEV__;
  if (isRelease && (!SENTRY_DSN || !POSTHOG_KEY)) {
    const missing = [!SENTRY_DSN && 'EXPO_PUBLIC_SENTRY_DSN', !POSTHOG_KEY && 'EXPO_PUBLIC_POSTHOG_API_KEY']
      .filter(Boolean)
      .join(', ');
    console.warn(
      `[analytics] Release build booted WITHOUT ${missing}. ` +
        'Crash reporting / product analytics are DISABLED. Set these in the EAS production profile.',
    );
  }
}

export type AnalyticsEvent =
  | 'restaurant_viewed'
  | 'add_to_cart'
  | 'checkout_opened'
  | 'order_placed'
  | 'order_cancelled'
  | 'promo_applied'
  | 'promo_rejected'
  | 'favorite_toggled'
  | 'reorder_tapped'
  | 'cross_sell_added'
  | 'push_permission'
  | 'search_performed'
  | 'referral_shared'
  | 'saved_order_created'
  // --- Package 01 §4 canonical funnel ------------------------------------
  // Documented in docs/ANALYTICS-DICTIONARY.md. The funnel these complete is
  //   app_opened -> restaurant_viewed -> add_to_cart -> checkout_opened
  //   -> order_placed -> order_delivered -> reorder_tapped
  | 'app_opened'
  | 'notification_opened'
  | 'cart_restored'
  | 'reorder_prepared'
  | 'order_delivered'
  | 'review_prompt_shown'
  | 'review_prompt_result'
  // --- Package 02 §D server-backed cart -----------------------------------
  // `cart_restored` above is shared with the Package 01 funnel: a cross-device
  // restore IS a cart restore, and splitting it would double-count.
  | 'cart_synced'
  | 'cart_conflict_shown'
  | 'cart_conflict_resolved'
  | 'cart_restore_failed'
  | 'cart_abandoned_eligible';

export type AnalyticsProps = Record<string, string | number | boolean | null | undefined>;

/**
 * Property-name fragments that must never reach the analytics provider.
 *
 * Enforced HERE rather than trusted to call sites: one `track('x', {notes})`
 * written months from now by someone who never read the spec would otherwise
 * ship free-text — which for this product means a customer's hotel room number,
 * delivery instructions or support message. A structural guard holds without
 * anyone remembering it.
 *
 * Matching is substring-based on the lower-cased key, so `delivery_notes`,
 * `roomNumber` and `push_token` are all caught. In __DEV__ a violation is loud;
 * in production the key is dropped and the rest of the event still ships —
 * losing one property beats losing the funnel, and beats leaking PII.
 */
const BANNED_PROPERTY_FRAGMENTS = [
  'phone',
  'email',
  'address',
  'room',
  'note',
  'token',
  'password',
  'message',
  'support_text',
  'lat',
  'lng',
  'coordinate',
] as const;

export function isBannedProperty(key: string): boolean {
  const k = key.toLowerCase();
  return BANNED_PROPERTY_FRAGMENTS.some((f) => k.includes(f));
}

/**
 * `__DEV__` is a React Native global and is genuinely absent under vitest and
 * in any non-RN context. Reading it bare threw a ReferenceError on the deny-list
 * path — i.e. the privacy guard itself could crash the caller. Resolve it
 * defensively instead.
 */
function isDev(): boolean {
  return typeof __DEV__ !== 'undefined' && __DEV__;
}

/**
 * Context every event carries. Set once at startup and on locale/currency/auth
 * change, so call sites cannot forget it and analytics.ts need not import the
 * session store (which would be circular and untestable).
 */
export interface AnalyticsContext {
  locale?: string;
  currency?: string;
  /** 'anonymous' | 'signed_in' — never the phone or user id itself. */
  authState?: 'anonymous' | 'signed_in';
  /** Acquisition source when known (referral, hotel, qr, …). */
  source?: string;
}

let context: AnalyticsContext = {};

export function setAnalyticsContext(next: AnalyticsContext): void {
  context = { ...context, ...next };
}

/** Test seam. */
export function __resetAnalyticsContext(): void {
  context = {};
}

export function track(event: AnalyticsEvent, props?: AnalyticsProps): void {
  if (!posthog) return;
  posthog.capture(event, buildProperties(props));
}

/**
 * Merge order: release identity -> context -> call-site props, then strip.
 * Call-site props win on collision so a screen can override e.g. `source`,
 * but nothing can smuggle past the deny-list, which is applied last.
 */
export function buildProperties(props?: AnalyticsProps): Record<string, string | number | boolean | null> {
  const merged: Record<string, unknown> = {
    ...releaseProperties(),
    ...(context.locale ? { locale: context.locale } : {}),
    ...(context.currency ? { display_currency: context.currency } : {}),
    ...(context.authState ? { auth_state: context.authState } : {}),
    ...(context.source ? { acquisition_source: context.source } : {}),
    ...(props ?? {}),
  };

  const clean: Record<string, string | number | boolean | null> = {};
  for (const [k, v] of Object.entries(merged)) {
    // PostHog's property type rejects `undefined` — drop them.
    if (v === undefined) continue;
    if (isBannedProperty(k)) {
      if (isDev()) {
        console.warn(`[analytics] property "${k}" is not allowed and was dropped (PII deny-list).`);
      }
      continue;
    }
    clean[k] = v as string | number | boolean | null;
  }
  return clean;
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
