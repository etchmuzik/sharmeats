/**
 * A place_order idempotency key that actually survives a retry.
 *
 * WHAT WENT WRONG
 * The key was minted in a `useRef` initializer on the checkout screen, so it was
 * stable only for the lifetime of ONE mount. But the failure path leaves the
 * cart untouched (deliberately — the customer should be able to try again), and
 * a customer whose "Place order" tap timed out backs out, re-enters checkout,
 * and taps again. That remount minted a NEW key, `place_order`'s dedup saw a
 * request it had never been asked before, and the first request — which may well
 * have committed on the server before the response was lost — became a second
 * real order: two kitchen tickets, two drivers, two cash collections for one
 * meal. A screen remount is exactly the case an idempotency key exists for, and
 * it was the one case the key did not cover.
 *
 * WHAT THIS DOES
 * Ties the key to the BASKET rather than to the screen. The same cart at the
 * same restaurant reuses the same key across remounts, app restarts and process
 * kills; changing the basket (adding an item, changing a quantity, switching
 * restaurant) is a genuinely different order and mints a fresh one. The key is
 * retired only once an order is actually created.
 *
 * The fingerprint deliberately covers only IDENTITY — restaurant, item, options,
 * quantity, notes. Prices are recomputed server-side and are not part of what
 * makes two attempts "the same order"; including them would mint a new key on a
 * menu price change and reopen the duplicate window.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { CartItem } from '../data/types';

const STORAGE_KEY = '@sharmeats:checkout-idempotency:v1';

interface StoredKey {
  fingerprint: string;
  key: string;
}

/**
 * Crash-safe uuid. Tries expo-crypto's randomUUID (best), but a native failure
 * (module-init throw on some device/arch combos) must NEVER break checkout —
 * falls back to a plain JS UUIDv4. The value only needs to be unique per
 * checkout attempt for place_order's dedup; cryptographic quality is not
 * required, and `p_idempotency_key` is typed `uuid`, so the SHAPE does matter.
 */
export function makeIdempotencyKey(): string {
  try {
    // Lazy require so the native module is only touched here, never at module-eval.
    const crypto = require('expo-crypto') as { randomUUID?: () => string };
    const id = crypto?.randomUUID?.();
    if (id) return id;
  } catch {
    // fall through to JS fallback
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * Stable identity of "this basket". Pure, so the duplicate-order rule is
 * testable without a store, a device or a network.
 *
 * Line ORDER is part of the fingerprint because the customer sees the basket in
 * that order; modifier order within a line is not, because it is not visible and
 * varies with how the options were tapped.
 */
export function cartFingerprint(restaurantId: string | null, lines: readonly CartItem[]): string {
  const parts = lines.map((l) =>
    [
      l.itemId,
      l.quantity,
      [...l.modifierChoices.map((c) => c.optionId)].sort().join('+'),
      l.notes ?? '',
      [...(l.allergens ?? [])].sort().join('+'),
    ].join('|'),
  );
  return `${restaurantId ?? ''}::${parts.join(';')}`;
}

/**
 * Decide whether a stored key can be reused for this basket. Pure half of
 * `loadIdempotencyKey`, split out so the reuse rule is directly testable.
 */
export function reusableKey(stored: StoredKey | null, fingerprint: string): string | null {
  if (!stored || typeof stored.key !== 'string' || stored.key.length === 0) return null;
  return stored.fingerprint === fingerprint ? stored.key : null;
}

/**
 * The idempotency key to send for this basket, minting and persisting one if
 * this basket has not been attempted yet.
 *
 * A storage failure is not fatal: we still return a usable key, we just lose the
 * cross-remount guarantee for this attempt — which is strictly no worse than the
 * behaviour this replaces.
 */
export async function loadIdempotencyKey(fingerprint: string): Promise<string> {
  let stored: StoredKey | null = null;
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (raw) stored = JSON.parse(raw) as StoredKey;
  } catch {
    stored = null;
  }
  const existing = reusableKey(stored, fingerprint);
  if (existing) return existing;

  const key = makeIdempotencyKey();
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify({ fingerprint, key } satisfies StoredKey));
  } catch {
    // See above — a key we could not persist is still better than no key.
  }
  return key;
}

/**
 * Retire the key. Called ONLY after an order genuinely exists, so a failed
 * attempt keeps its key and a retry stays deduplicated.
 */
export async function clearIdempotencyKey(): Promise<void> {
  try {
    await AsyncStorage.removeItem(STORAGE_KEY);
  } catch {
    // Best-effort: a stale key is harmless — the next basket has a different
    // fingerprint and mints its own.
  }
}
