/**
 * Convert an untrusted backend/auth error into safe, staff-facing copy.
 *
 * Database and auth errors can include SQL details or customer data. UI code
 * must not render them directly. This helper only checks a bounded value for
 * recognised machine markers and always returns static application copy.
 */
export type DisplayErrorOptions = {
  /** Safe copy used when no known marker applies. */
  fallback?: string;
  /** Static, caller-owned messages keyed by known backend markers. */
  known?: Readonly<Record<string, string>>;
};

const DEFAULT_FALLBACK = 'Something went wrong. Please try again.';
const MAX_ERROR_TEXT_LENGTH = 512;

const DEFAULT_COPY: Readonly<Record<string, string>> = {
  AUTH_REQUIRED: 'Your session has expired. Please sign in again.',
  JWT_EXPIRED: 'Your session has expired. Please sign in again.',
  INVALID_LOGIN_CREDENTIALS: 'Email or password is incorrect.',
  EMAIL_NOT_CONFIRMED: 'Confirm your email before signing in.',
  WEAK_PASSWORD: 'Use a stronger password and try again.',
  RATE_LIMIT: 'Too many attempts. Please wait a moment and try again.',
  TOO_MANY_REQUESTS: 'Too many attempts. Please wait a moment and try again.',
  NOT_AUTHORIZED: 'You do not have permission to do that.',
  PERMISSION_DENIED: 'You do not have permission to do that.',
  '42501': 'You do not have permission to do that.',
  '23505': 'That record already exists.',
};

/**
 * Whether an error contains a bounded, explicit machine marker. This is for
 * control flow only; it never exposes the error text to a caller.
 */
export function hasErrorMarker(error: unknown, marker: string): boolean {
  const normalisedMarker = marker.trim().toUpperCase();
  if (!/^[A-Z0-9_.:-]{1,64}$/.test(normalisedMarker)) return false;

  return errorText(error).some((text) => text.includes(normalisedMarker));
}

export function safeDisplayError(
  error: unknown,
  { fallback = DEFAULT_FALLBACK, known = {} }: DisplayErrorOptions = {},
): string {
  const markerCopy = { ...DEFAULT_COPY, ...known };
  for (const [marker, copy] of Object.entries(markerCopy)) {
    if (hasErrorMarker(error, marker)) return copy;
  }

  return fallback;
}

function errorText(error: unknown): string[] {
  if (typeof error === 'string') return [bounded(error)];
  if (error === null || typeof error !== 'object') return [];

  const record = error as Record<string, unknown>;
  return [record.code, record.message]
    .filter((value): value is string => typeof value === 'string')
    .map(bounded);
}

function bounded(value: string): string {
  return value.slice(0, MAX_ERROR_TEXT_LENGTH).toUpperCase();
}
