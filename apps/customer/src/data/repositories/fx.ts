import type { FxRepository, ServerFxRate } from '../types';
import { ALL_CURRENCIES } from '../../currency/fx';

/**
 * Mock FX repository: serves the static planning table AS IF it were a fresh
 * server response, so the resolver/staleness logic upstream is exercised the
 * same way in both modes. The mock is always "fresh" — staleness behavior is
 * tested at the rates-store level, not by making the mock lie about time.
 */
export const fxRepo: FxRepository = {
  async currentRates(): Promise<ServerFxRate[]> {
    const STATIC: Record<string, number> = { EUR: 52.85, USD: 48.4, GBP: 61.5, RUB: 0.51 };
    const now = new Date().toISOString();
    return ALL_CURRENCIES.filter((c) => c !== 'EGP').map((c) => ({
      quoteCurrency: c,
      rate: STATIC[c] ?? 1,
      source: 'mock',
      effectiveAt: now,
      stale: false,
    }));
  },
};
