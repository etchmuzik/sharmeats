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

export function currencyLabel(currency: Currency): string {
  return currency;
}

export const ALL_CURRENCIES: Currency[] = ['EGP', 'EUR', 'USD', 'GBP', 'RUB'];
