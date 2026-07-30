import { getSupabase } from './client';
import type { FxRepository, ServerFxRate } from '../types';

/**
 * Live FX repository (Package 05 Slice B).
 *
 * `current_fx_rates` (mig 182) is the ONE client-facing rate read: active rate
 * per quote currency with a server-computed stale flag. It is granted to anon
 * deliberately — a tourist picks a display currency before signing in.
 *
 * The rows are display metadata only. Nothing here participates in pricing:
 * place_order recomputes every EGP amount server-side, and no client-supplied
 * rate is accepted anywhere.
 */
export const fxRepoSupabase: FxRepository = {
  async currentRates(): Promise<ServerFxRate[]> {
    const { data, error } = await getSupabase().rpc('current_fx_rates');
    if (error) throw error;
    if (!Array.isArray(data)) return [];
    return data.map((r: Record<string, unknown>) => ({
      quoteCurrency: String(r.quote_currency),
      // numeric arrives as a string through PostgREST; Number() both parses it
      // and turns garbage into NaN, which the store filters out.
      rate: Number(r.rate),
      source: String(r.source ?? ''),
      effectiveAt: String(r.effective_at ?? ''),
      stale: r.stale === true,
    }));
  },
};
