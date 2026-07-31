/**
 * Display-FX rules for the ops dashboard, kept pure and separate from the React
 * that calls them.
 *
 * WHY THIS EXISTS: migration 182 gave display FX a server home with real
 * freshness metadata and exactly one human writer — admin_set_fx_rate. No
 * operator surface was ever built for it. The four seeded rates
 * (baseline:static-table, the Phase-0 planning numbers) carry a 7-day shelf
 * life and expire 2026-08-06, after which current_fx_rates() reports every
 * currency stale, the customer app must label conversions approximate or fall
 * back to EGP-only, and the nightly fx_rates_health_sweep alert has nowhere to
 * send anyone. This module is the client half of the fix.
 *
 * Every bound below MIRRORS a check inside fx_apply_observation. The RPC is the
 * authority — this is here so an operator learns about a typo before spending a
 * round trip, and so the error they get back is one they can act on.
 */

/** The quote currencies migration 182 supports. EGP is always the base. */
export const QUOTE_CURRENCIES = ['EUR', 'USD', 'GBP', 'RUB'] as const;
export type QuoteCurrency = (typeof QUOTE_CURRENCIES)[number];

/**
 * EGP per 1 unit of the quote currency — the same orientation as the client's
 * RATES_PER_UNIT, so an inverted rate (0.019 instead of ~52) is visibly wrong
 * and fails the bounds check rather than mispricing every conversion.
 */
export const RATE_MIN = 0.05;
export const RATE_MAX = 500;

/** Shelf life, in hours. The RPC accepts 1..720; manual rates default to 7 days. */
export const STALE_HOURS_MIN = 1;
export const STALE_HOURS_MAX = 720;
export const STALE_HOURS_DEFAULT = 168;

/** fx_apply_observation alerts ops above this move and rejects it without allow_jump. */
export const JUMP_ALERT_PCT = 10;

/** Minimum reason length, matching admin_set_fx_rate's REASON_REQUIRED guard. */
export const REASON_MIN_LENGTH = 3;

/** One row of current_fx_rates(). `stale` is computed server-side from now(). */
export interface FxRateRow {
  quote_currency: string;
  rate: number;
  source: string;
  effective_at: string;
  stale_after: string;
  stale: boolean;
}

export type FxHealth = 'live' | 'expiring' | 'stale' | 'missing';

/** Inside this window an operator still has time to act before the rate expires. */
export const EXPIRING_SOON_HOURS = 72;

/**
 * How a currency is doing, from the operator's point of view rather than the
 * database's. `missing` is the state the database cannot report at all — there
 * is simply no row — and it is the one that matters most, because a currency
 * with no active rate silently disappears from the customer's conversion.
 */
export function fxHealth(row: FxRateRow | undefined, now: Date = new Date()): FxHealth {
  if (!row) return 'missing';
  const expiresAt = new Date(row.stale_after).getTime();
  // Trust the server's flag first: it was computed against the database clock,
  // and a browser with a skewed clock must not be able to call a stale rate
  // live. The local comparison only ever ADDS the earlier warning.
  if (row.stale || expiresAt <= now.getTime()) return 'stale';
  if (expiresAt - now.getTime() <= EXPIRING_SOON_HOURS * 3600_000) return 'expiring';
  return 'live';
}

/** Whole hours until a rate expires. Negative once it has. */
export function hoursUntil(iso: string, now: Date = new Date()): number {
  return Math.round((new Date(iso).getTime() - now.getTime()) / 3600_000);
}

/** "in 5d", "in 14h", "3d ago" — the shape the founding-rates report uses. */
export function expiryLabel(iso: string, now: Date = new Date()): string {
  const hours = hoursUntil(iso, now);
  const abs = Math.abs(hours);
  const amount = abs >= 48 ? `${Math.round(abs / 24)}d` : `${abs}h`;
  if (hours < 0) return `${amount} ago`;
  return `in ${amount}`;
}

/** The percentage move a proposed rate represents, or null with no previous rate. */
export function jumpPct(previous: number | undefined, next: number): number | null {
  if (previous === undefined || previous <= 0) return null;
  return Math.abs(next - previous) / previous * 100;
}

export interface FxFormInput {
  quote: string;
  rate: string;
  reason: string;
  staleHours: string;
}

export interface FxFormValues {
  quote: QuoteCurrency;
  rate: number;
  reason: string;
  staleHours: number;
}

export type FxValidation =
  | { ok: true; values: FxFormValues }
  | { ok: false; error: string };

/**
 * Validate the override form against the RPC's own bounds.
 *
 * Fails on the FIRST problem rather than collecting them: this is a four-field
 * form where the fields are independent, and one clear sentence beats a list.
 */
export function validateFxForm(input: FxFormInput): FxValidation {
  const quote = input.quote.trim().toUpperCase();
  if (!(QUOTE_CURRENCIES as readonly string[]).includes(quote)) {
    return { ok: false, error: `Currency must be one of ${QUOTE_CURRENCIES.join(', ')}.` };
  }

  const rate = Number(input.rate);
  if (input.rate.trim() === '' || !Number.isFinite(rate)) {
    return { ok: false, error: 'Enter the rate as a number — EGP per 1 unit of the currency.' };
  }
  if (rate < RATE_MIN || rate > RATE_MAX) {
    return {
      ok: false,
      error: `${rate} is outside ${RATE_MIN}–${RATE_MAX} EGP per unit. Check the orientation: EGP per 1 ${quote}, not ${quote} per EGP.`,
    };
  }

  const reason = input.reason.trim();
  if (reason.length < REASON_MIN_LENGTH) {
    return { ok: false, error: 'Say where this rate came from — the reason is stored on the row forever.' };
  }

  const staleHours = Number(input.staleHours);
  if (!Number.isInteger(staleHours) || staleHours < STALE_HOURS_MIN || staleHours > STALE_HOURS_MAX) {
    return {
      ok: false,
      error: `Shelf life must be a whole number of hours between ${STALE_HOURS_MIN} and ${STALE_HOURS_MAX} (30 days).`,
    };
  }

  return { ok: true, values: { quote: quote as QuoteCurrency, rate, reason, staleHours } };
}

/**
 * Turn migration 182's error strings into something an operator can act on.
 *
 * RATE_JUMP_REJECTED is the one that matters: it is not a failure, it is the
 * database asking for a second decision, and the UI must say so rather than
 * showing a raw `check_violation`.
 */
export function describeFxError(message: string | null | undefined): string {
  const m = message ?? '';
  if (!m) return 'Could not set that rate. Try again.';
  if (m.includes('RATE_JUMP_REJECTED')) {
    return `That is a move of more than ${JUMP_ALERT_PCT}% from the live rate. If it is real, tick “this jump is intended” and submit again — ops gets an alert either way.`;
  }
  if (m.includes('RATE_OUT_OF_BOUNDS')) {
    return `The rate failed the ${RATE_MIN}–${RATE_MAX} sanity range. It is EGP per 1 unit of the currency.`;
  }
  if (m.includes('STALE_WINDOW_OUT_OF_BOUNDS')) {
    return `Shelf life must be between ${STALE_HOURS_MIN} and ${STALE_HOURS_MAX} hours.`;
  }
  if (m.includes('REASON_REQUIRED')) {
    return 'A reason of at least three characters is required.';
  }
  if (m.includes('UNSUPPORTED_QUOTE_CURRENCY')) {
    return `Only ${QUOTE_CURRENCIES.join(', ')} are supported.`;
  }
  if (m.includes('NOT_AUTHORIZED')) {
    return 'Only an admin account can set FX rates.';
  }
  return m;
}

/**
 * True when the failure means migration 182 has not reached this database yet.
 * The web surface deploys independently of the DB, so "function not found" is a
 * deploy-order fact to explain, not an error to alarm anyone with. Anything
 * else is a real failure and must surface — the same rule the finance page's
 * revenue panel already follows.
 */
export function isMissingFunction(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  return error.code === 'PGRST202' || /could not find the function/i.test(error.message ?? '');
}
