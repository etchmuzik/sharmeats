/**
 * Backend auth errors -> translated i18n keys.
 *
 * The sign-in and OTP screens used to render `e.message` verbatim. Those
 * messages are written for whoever is wiring the backend up, not for a tourist
 * standing in a hotel lobby — the worst of them told the customer to
 * "enable a Phone provider in Supabase → Authentication → Providers → Phone",
 * which is both meaningless and a disclosure of our stack. Meanwhile
 * `error.otpSendFailed` / `error.otpInvalid` / `error.otpResendFailed` already
 * existed in all five locales and were unreachable.
 *
 * So: never render a backend string. Classify it here, return a KEY, and let the
 * screen translate. The raw message still reaches Sentry via captureError, which
 * is where an operator can actually read it.
 */

/** Supabase surfaces its HTTP status on the error object; 429 = rate limited. */
function statusOf(error: unknown): number | undefined {
  const s = (error as { status?: unknown } | null)?.status;
  return typeof s === 'number' ? s : undefined;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : typeof error === 'string' ? error : '';
}

/**
 * Which translated string should the customer see for this auth failure?
 *
 * `fallbackKey` is the screen's own "this operation failed" string, used for
 * anything we cannot classify — the honest answer when we genuinely do not know
 * more than "it did not work".
 */
export function authErrorKey(error: unknown, fallbackKey: string): string {
  const status = statusOf(error);
  const msg = messageOf(error).toLowerCase();

  // Rate limiting is worth its own message: "try again" is actively wrong advice
  // when the server is asking the customer to WAIT.
  if (status === 429 || /rate limit|too many|for security purposes/.test(msg)) {
    return 'error.otpTooMany';
  }
  // Offline / DNS / timeout. `fetch` failures surface as a TypeError with these
  // shapes across platforms.
  if (
    /network request failed|failed to fetch|network error|timeout|timed out|offline|econnrefused|enotfound/.test(
      msg,
    )
  ) {
    return 'error.network';
  }
  // An invalid/expired one-time code, whatever wording the provider chose.
  if (/invalid or expired|token has expired|otp_expired|invalid token|incorrect/.test(msg)) {
    return 'error.otpInvalid';
  }
  return fallbackKey;
}
