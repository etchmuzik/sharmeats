/**
 * Mock server-cart adapter.
 *
 * Its job is to make the SAME mistakes the real backend would, so the sync and
 * conflict code is exercised offline. In particular it enforces the version
 * check: a stale write returns `{ ok: false, conflict: true }` rather than
 * quietly succeeding. A mock that always accepted writes would let the conflict
 * path rot until the first real two-device collision in production.
 *
 * State is module-level and per-process, which is exactly the "one cart per
 * account" shape of the real table (mig 168).
 */
import type { ServerCart, ServerCartLine, ServerCartWrite } from '../types';

const TTL_DAYS = 30;

function ttlFromNow(): string {
  return new Date(Date.now() + TTL_DAYS * 24 * 60 * 60 * 1000).toISOString();
}

/** The single stored cart, or null when none exists (matches "no row"). */
let stored: ServerCart | null = null;

const delay = <T>(value: T, ms = 40): Promise<T> =>
  new Promise((resolve) => setTimeout(() => resolve(value), ms));

export const cartRepo = {
  async get(): Promise<ServerCart | null> {
    return delay(stored ? { ...stored, lines: stored.lines.map((l) => ({ ...l })) } : null);
  },

  async upsert(input: {
    restaurantId: string | null;
    lines: ServerCartLine[];
    kitchenNotes?: string;
    expectedVersion: number;
  }): Promise<ServerCartWrite> {
    const current = stored?.version ?? 0;
    // Same contract as upsert_my_cart: the caller states the version it believes
    // it is editing, and a mismatch writes nothing. `expectedVersion === 0`
    // means "I have no server cart".
    if (input.expectedVersion !== current) {
      return delay({ ok: false as const, conflict: true as const });
    }
    const next: ServerCart = {
      restaurantId: input.restaurantId,
      lines: input.lines.map((l) => ({ ...l })),
      kitchenNotes: input.kitchenNotes?.trim() ? input.kitchenNotes.trim() : undefined,
      version: current + 1,
      updatedAt: new Date().toISOString(),
      expiresAt: ttlFromNow(),
    };
    stored = next;
    return delay({
      ok: true as const,
      version: next.version,
      updatedAt: next.updatedAt,
      expiresAt: next.expiresAt,
    });
  },

  /** Versionless and idempotent, like clear_my_cart. */
  async clear(): Promise<void> {
    stored = null;
    return delay(undefined);
  },

  /** Test seam: reset module state between tests. Not part of the live contract. */
  __resetForTests(seed: ServerCart | null = null): void {
    stored = seed;
  },
};
