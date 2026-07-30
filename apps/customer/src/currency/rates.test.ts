/**
 * Server FX resolver (Package 05 Slice B).
 *
 * The property chain worth guarding: server rate > cached server rate (aging
 * to stale) > static planning table (ALWAYS stale) — and a stale anything must
 * say so, because the checkout label switches on that flag.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const storage = new Map<string, string>();
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn((k: string) => Promise.resolve(storage.get(k) ?? null)),
    setItem: vi.fn((k: string, v: string) => {
      storage.set(k, v);
      return Promise.resolve();
    }),
  },
}));

const currentRates = vi.fn();
vi.mock('../data', () => ({ db: { fx: { currentRates: () => currentRates() } } }));

import {
  hydrateFxRates,
  refreshFxRates,
  resolveRate,
  __resetFxSnapshotForTest,
  __setFxSnapshotForTest,
} from './rates';

const FRESH_EUR = {
  quoteCurrency: 'EUR',
  rate: 55.12,
  source: 'frankfurter.dev',
  effectiveAt: '2026-07-30T08:00:00.000Z',
  stale: false,
};

beforeEach(() => {
  storage.clear();
  currentRates.mockReset();
  __resetFxSnapshotForTest();
});

describe('resolution order', () => {
  it('EGP never resolves — it needs no rate', () => {
    expect(resolveRate('EGP')).toBeNull();
  });

  it('falls back to the static table, ALWAYS stale, before any server contact', () => {
    const r = resolveRate('EUR');
    expect(r?.source).toBe('static');
    expect(r?.stale).toBe(true);
    expect(r?.effectiveAt).toBeNull();
  });

  it('prefers a fetched server rate, fresh and dated', async () => {
    currentRates.mockResolvedValue([FRESH_EUR]);
    await refreshFxRates();
    const r = resolveRate('EUR');
    expect(r).toEqual({
      rate: 55.12,
      source: 'server',
      stale: false,
      effectiveAt: '2026-07-30T08:00:00.000Z',
    });
  });

  it('a SERVER-stale rate still converts but carries the stale flag', async () => {
    currentRates.mockResolvedValue([{ ...FRESH_EUR, stale: true }]);
    await refreshFxRates();
    expect(resolveRate('EUR')?.stale).toBe(true);
    expect(resolveRate('EUR')?.source).toBe('server');
  });
});

describe('degradation', () => {
  it('a failed refresh keeps the last-known snapshot serving', async () => {
    currentRates.mockResolvedValue([FRESH_EUR]);
    await refreshFxRates();
    currentRates.mockRejectedValue(new Error('offline'));
    await refreshFxRates(); // must not throw
    expect(resolveRate('EUR')?.rate).toBe(55.12);
  });

  it('an EMPTY server answer is not better information — snapshot stands', async () => {
    currentRates.mockResolvedValue([FRESH_EUR]);
    await refreshFxRates();
    currentRates.mockResolvedValue([]);
    await refreshFxRates();
    expect(resolveRate('EUR')?.rate).toBe(55.12);
  });

  it('NaN/zero rates never enter the snapshot (the undefinedNaN class of bug)', async () => {
    currentRates.mockResolvedValue([
      { ...FRESH_EUR, rate: Number.NaN },
      { ...FRESH_EUR, quoteCurrency: 'USD', rate: 0 },
    ]);
    await refreshFxRates();
    expect(resolveRate('EUR')?.source).toBe('static'); // fell through
    expect(resolveRate('USD')?.source).toBe('static');
  });

  it('a cache older than the local trust window resolves stale even if the server said fresh', () => {
    const threeDaysAgo = Date.now() - 3 * 24 * 60 * 60 * 1000;
    __setFxSnapshotForTest([FRESH_EUR], threeDaysAgo);
    const r = resolveRate('EUR');
    expect(r?.source).toBe('server');
    expect(r?.stale).toBe(true); // the flag was computed at fetch time; time passed
  });
});

describe('persistence round-trip', () => {
  it('hydrate restores the last fetch, including its age', async () => {
    currentRates.mockResolvedValue([FRESH_EUR]);
    await refreshFxRates(); // writes the cache
    __resetFxSnapshotForTest();
    expect(resolveRate('EUR')?.source).toBe('static'); // proof of reset
    await hydrateFxRates();
    expect(resolveRate('EUR')?.source).toBe('server');
    expect(resolveRate('EUR')?.rate).toBe(55.12);
  });

  it('a corrupt cache degrades quietly to the static fallback', async () => {
    storage.set('@sharmeats:fxRates:v1', '{not json');
    await hydrateFxRates(); // must not throw
    expect(resolveRate('EUR')?.source).toBe('static');
  });
});
