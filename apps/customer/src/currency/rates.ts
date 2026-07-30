/**
 * Server FX rates: fetch, cache, resolve (Package 05 Slice B).
 *
 * The static table in fx.ts had silently been the only rate source since
 * Phase-0 — never updated, labeled "indicative" but with no freshness at all.
 * Mig 182 gives rates a server home with real staleness metadata; this module
 * is the client half:
 *
 *   * one refresh per app start (plus manual retries by callers) pulls
 *     `current_fx_rates` and persists it to AsyncStorage;
 *   * the LAST KNOWN server rates hydrate synchronously usable state, so a
 *     plane-mode launch still shows the most recent real rate, honestly dated;
 *   * `resolveRate()` is the ONE lookup the formatters use. It prefers server
 *     rates (fresh or stale-but-labeled) and falls back to the static planning
 *     table only when no server rate has EVER been seen — flagged
 *     `source: 'static'` so the UI can refuse to present it as current.
 *
 * A stale server rate is deliberately still USED for conversion — a two-week-old
 * real rate converts better than a Phase-0 planning number — but `stale: true`
 * forces the "approximate, updated <date>" label instead of the plain
 * indicative line. Display only: nothing here can influence an EGP charge.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { db } from '../data';
import type { ServerFxRate } from '../data/types';
import { type Currency, RATES_PER_UNIT_STATIC } from './fx';

const CACHE_KEY = '@sharmeats:fxRates:v1';

/** How long a cached-but-unrefreshed rate stays trusted as "fresh" locally.
 * The server's own stale flag wins when present; this guards the offline case
 * where the cache itself ages without any server contact. */
const LOCAL_TRUST_MS = 48 * 60 * 60 * 1000;

export interface ResolvedRate {
  /** EGP per 1 unit. */
  rate: number;
  /** 'server' (live fetch or cache) or 'static' (Phase-0 planning table). */
  source: 'server' | 'static';
  /** True when the rate must be presented as approximate/dated, never current. */
  stale: boolean;
  /** ISO time the rate became effective; null for the static fallback. */
  effectiveAt: string | null;
}

interface CacheShape {
  fetchedAt: string;
  rates: ServerFxRate[];
}

let snapshot: Map<string, ServerFxRate> = new Map();
let snapshotFetchedAt: number | null = null;

function apply(rates: ServerFxRate[], fetchedAtMs: number): void {
  const next = new Map<string, ServerFxRate>();
  for (const r of rates) {
    // NaN rates (PostgREST numeric parsing, corrupted cache) never enter the
    // snapshot — resolveRate then falls back rather than rendering NaN.
    if (Number.isFinite(r.rate) && r.rate > 0) next.set(r.quoteCurrency, r);
  }
  snapshot = next;
  snapshotFetchedAt = fetchedAtMs;
}

/** Load the last persisted server response. Safe to call before any network. */
export async function hydrateFxRates(): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(CACHE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as Partial<CacheShape>;
    if (!Array.isArray(parsed.rates)) return;
    const fetchedAt = Date.parse(parsed.fetchedAt ?? '');
    apply(parsed.rates, Number.isFinite(fetchedAt) ? fetchedAt : 0);
  } catch {
    // A corrupt cache degrades to the static fallback; it must never throw
    // into app startup.
  }
}

/** Fetch fresh rates; on failure the existing snapshot (or fallback) stands. */
export async function refreshFxRates(): Promise<void> {
  try {
    const rates = await db.fx.currentRates();
    if (rates.length === 0) return; // an empty answer is not better information
    const now = Date.now();
    apply(rates, now);
    AsyncStorage.setItem(
      CACHE_KEY,
      JSON.stringify({ fetchedAt: new Date(now).toISOString(), rates } satisfies CacheShape),
    ).catch(() => {});
  } catch {
    // Offline / backend down: last-known rates keep serving, aging toward
    // stale via LOCAL_TRUST_MS. Deliberately quiet — a conversion hint must
    // never surface a network error.
  }
}

export function resolveRate(currency: Currency): ResolvedRate | null {
  if (currency === 'EGP') return null; // EGP needs no rate, by definition

  const server = snapshot.get(currency);
  if (server) {
    const cacheAged =
      snapshotFetchedAt !== null && Date.now() - snapshotFetchedAt > LOCAL_TRUST_MS;
    return {
      rate: server.rate,
      source: 'server',
      stale: server.stale || cacheAged,
      effectiveAt: server.effectiveAt || null,
    };
  }

  const staticRate = RATES_PER_UNIT_STATIC[currency];
  if (!staticRate) return null;
  // The planning table is ALWAYS stale by definition — it has no effective
  // date and no freshness. It exists so a first launch in a dead zone still
  // shows an order of magnitude, clearly labeled approximate.
  return { rate: staticRate, source: 'static', stale: true, effectiveAt: null };
}

/** Test seam. */
export function __setFxSnapshotForTest(rates: ServerFxRate[], fetchedAtMs: number | null): void {
  apply(rates, fetchedAtMs ?? Date.now());
  snapshotFetchedAt = fetchedAtMs;
}

export function __resetFxSnapshotForTest(): void {
  snapshot = new Map();
  snapshotFetchedAt = null;
}
