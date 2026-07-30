export type Currency = 'EGP' | 'EUR' | 'USD' | 'GBP' | 'RUB';

/**
 * Static planning rates (EGP per 1 unit of currency), reviewed MANUALLY.
 *
 * There is NO live FX feed — the previous comment claiming a daily edge
 * function was aspirational fiction (removed 2026-07-27). Every UI surface
 * must therefore present conversions as indicative/approximate, never as
 * "today's rate" (checkout.conversion and onboarding.desc3 were reworded to
 * match). Customers always pay in EGP; these numbers are display-only.
 * Build a real daily feed when card payments go live; until then, updating
 * this table is a manual ops task.
 */
const RATES_PER_UNIT: Record<Currency, number> = {
  EGP: 1,
  EUR: 52.85,
  USD: 48.4,
  GBP: 61.5,
  RUB: 0.51,
};

/**
 * The static table, exported for the OFFLINE-FALLBACK role only (rates.ts).
 * Since mig 182 the server (`current_fx_rates`) is the rate source of truth;
 * these numbers serve a first launch with no connectivity, always resolved
 * with `source: 'static', stale: true` so no UI can present them as current.
 */
export const RATES_PER_UNIT_STATIC: Record<Currency, number> = RATES_PER_UNIT;

const SYMBOLS: Record<Currency, string> = {
  EGP: 'EGP',
  EUR: '€',
  USD: '$',
  GBP: '£',
  RUB: '₽',
};

export function convertFromEgp(amountEgp: number, target: Currency): number {
  if (target === 'EGP') return amountEgp;
  return amountEgp / RATES_PER_UNIT[target];
}

export function formatCurrency(amountEgp: number, currency: Currency): string {
  if (currency === 'EGP') return `EGP ${Math.round(amountEgp).toLocaleString('en-US')}`;
  const converted = convertFromEgp(amountEgp, currency);
  return `${SYMBOLS[currency]}${converted.toFixed(2)}`;
}

export function fxRateLine(currency: Currency): string | null {
  if (currency === 'EGP') return null;
  return `1 ${currency} = ${RATES_PER_UNIT[currency].toFixed(2)} EGP`;
}

/**
 * Rate-parameterized variants: same formatting, but the RATE comes from the
 * resolver (rates.ts) instead of the static table. The un-parameterized
 * functions above remain for the static-fallback path and existing tests;
 * render surfaces should prefer these with `resolveRate()`.
 */
export function formatCurrencyAtRate(amountEgp: number, currency: Currency, rate: number): string {
  if (currency === 'EGP') return `EGP ${Math.round(amountEgp).toLocaleString('en-US')}`;
  return `${SYMBOLS[currency]}${(amountEgp / rate).toFixed(2)}`;
}

export function fxRateLineAtRate(currency: Currency, rate: number): string | null {
  if (currency === 'EGP') return null;
  return `1 ${currency} = ${rate.toFixed(2)} EGP`;
}

export function currencyLabel(currency: Currency): string {
  return currency;
}

export const ALL_CURRENCIES: Currency[] = ['EGP', 'EUR', 'USD', 'GBP', 'RUB'];

/**
 * Boundary validator for values arriving from OUTSIDE the type system —
 * AsyncStorage hydration, deep links, server rows.
 *
 * The session store used to cast its persisted string straight to `Currency`.
 * A corrupted or legacy value (say "SAR") then flowed into formatCurrency and
 * fxRateLine, where `RATES_PER_UNIT[target]` is undefined: the checkout
 * conversion line rendered "undefinedNaN" and `.toFixed` on undefined threw a
 * TypeError — a crash in checkout caused by a display preference. EGP is the
 * only always-safe fallback: it needs no rate.
 */
export function asSupportedCurrency(value: unknown): Currency {
  return typeof value === 'string' && (ALL_CURRENCIES as string[]).includes(value)
    ? (value as Currency)
    : 'EGP';
}
