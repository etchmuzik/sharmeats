import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { AllergyKey, CartItem, CartItemModifierChoice } from '../data/types';
import { db, isBackendLive } from '../data';
import { toServerLines } from '../lib/cartSync';
import { track } from '../lib/analytics';

const STORAGE_KEY = '@sharmeats:cart:v1';

interface CartState {
  restaurantId: string | null;
  restaurantName: string | null;
  lines: CartItem[];
  hydrated: boolean;

  hydrate: () => Promise<void>;
  add: (item: {
    itemId: string;
    restaurantId: string;
    restaurantName: string;
    name: string;
    basePriceEgp: number;
    image: string;
    quantity: number;
    modifierChoices: CartItemModifierChoice[];
    notes?: string;
    allergens?: AllergyKey[];
  }) => void;
  updateLine: (
    lineId: string,
    patch: {
      quantity: number;
      modifierChoices: CartItemModifierChoice[];
      notes?: string;
      allergens?: AllergyKey[];
    },
  ) => void;
  /** Replace the cart with all lines from a past order. Same-restaurant lock applies. */
  loadFromOrder: (input: {
    restaurantId: string;
    restaurantName: string;
    lines: CartItem[];
  }) => void;
  setQuantity: (lineId: string, qty: number) => void;
  remove: (lineId: string) => void;
  /**
   * Drop the LOCAL basket only.
   *
   * Deliberately does NOT touch the server cart (mig 168). Sign-out and identity
   * teardown call this, and an account's saved basket must survive to the next
   * sign-in — deleting it here would turn "hand the phone to a friend" into
   * "lose your basket on every device". Retiring the server row is a separate,
   * explicit act: see `clearEverywhere`.
   */
  clear: () => void;
  /**
   * Empty the basket on this device AND retire the stored server cart.
   *
   * For the two cases where the customer's basket is genuinely finished: a
   * confirmed order placement, and an explicit "empty cart" tap. Never call this
   * from sign-out.
   */
  clearEverywhere: () => Promise<void>;
  count: () => number;
  subtotal: () => number;

  /**
   * Server-cart mirror state. `serverVersion` is the optimistic-concurrency
   * token last confirmed by the server; 0 means "no server cart known".
   */
  serverVersion: number;
  /** Mirror the current basket to the server, coalescing rapid edits. */
  syncToServer: () => void;
  /** Adopt a server cart into the local basket after prepare_cart reconciled it. */
  adoptPrepared: (input: {
    restaurantId: string;
    restaurantName: string;
    lines: CartItem[];
    version: number;
  }) => void;
  /** Record a server version without changing the basket (in-sync case). */
  setServerVersion: (version: number) => void;
}

function persist(state: Pick<CartState, 'restaurantId' | 'restaurantName' | 'lines'>) {
  AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(state)).catch(() => {});
}

function makeLineId(): string {
  return `l-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

/**
 * Coalesce rapid cart edits into one server write.
 *
 * A basket mutates on every +/- tap. Writing each one would burn round trips
 * and, worse, make a device collide with its OWN in-flight write: two writes
 * racing with the same expected version means one comes back
 * CART_VERSION_CONFLICT and the customer is asked to resolve a conflict with
 * themselves. Serialising through one timer avoids that entirely.
 */
const SYNC_DEBOUNCE_MS = 1200;
let syncTimer: ReturnType<typeof setTimeout> | null = null;
/** True while a write is in flight, so a queued edit waits rather than races. */
let syncInFlight = false;
let syncInFlightPromise: Promise<void> | null = null;
/** An edit arrived during a write; run one more pass when it finishes. */
let syncDirty = false;
/** Invalidates responses from writes that began before a destructive clear. */
let syncEpoch = 0;
/** Holds new writes until clear_my_cart has run after any older upsert. */
let serverClearInFlight = false;

function priceForLine(line: CartItem): number {
  const mods = line.modifierChoices.reduce((acc, c) => acc + c.priceDeltaEgp, 0);
  return (line.basePriceEgp + mods) * line.quantity;
}

export const useCart = create<CartState>((set, get) => ({
  restaurantId: null,
  restaurantName: null,
  lines: [],
  hydrated: false,

  hydrate: async () => {
    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<
          Pick<CartState, 'restaurantId' | 'restaurantName' | 'lines'>
        >;
        // Coerce `lines` to an array. If stored data is corrupt/old-format and
        // `lines` is missing or non-array, count()/subtotal() would .reduce() on
        // a non-array and throw during render in the always-mounted TabBar.
        // (Mirrors the Array.isArray guard in session.ts hydrate.)
        set({
          restaurantId: parsed.restaurantId ?? null,
          restaurantName: parsed.restaurantName ?? null,
          lines: Array.isArray(parsed.lines) ? parsed.lines : [],
          hydrated: true,
        });
        return;
      }
    } catch {
      /* ignore */
    }
    set({ hydrated: true });
  },

  add: (item) => {
    const current = get();
    // Single-restaurant cart. If different restaurant, replace.
    const sameRestaurant = current.restaurantId === item.restaurantId;
    const baseLines = sameRestaurant ? current.lines : [];

    // Merge if same item + identical modifier set + no notes + identical allergens.
    const sameAllergens = (a?: AllergyKey[], b?: AllergyKey[]): boolean => {
      const aa = (a ?? []).slice().sort();
      const bb = (b ?? []).slice().sort();
      if (aa.length !== bb.length) return false;
      return aa.every((v, i) => v === bb[i]);
    };
    const sameSig = (l: CartItem) =>
      l.itemId === item.itemId &&
      !l.notes &&
      !item.notes &&
      l.modifierChoices.length === item.modifierChoices.length &&
      l.modifierChoices.every((c, i) => c.optionId === item.modifierChoices[i]?.optionId) &&
      sameAllergens(l.allergens, item.allergens);
    const idx = baseLines.findIndex(sameSig);

    let lines: CartItem[];
    if (idx >= 0) {
      lines = baseLines.map((l, i) =>
        i === idx ? { ...l, quantity: l.quantity + item.quantity } : l,
      );
    } else {
      lines = [
        ...baseLines,
        {
          lineId: makeLineId(),
          itemId: item.itemId,
          restaurantId: item.restaurantId,
          name: item.name,
          basePriceEgp: item.basePriceEgp,
          image: item.image,
          quantity: item.quantity,
          modifierChoices: item.modifierChoices,
          notes: item.notes,
          allergens: item.allergens,
        },
      ];
    }
    const next = {
      restaurantId: item.restaurantId,
      restaurantName: item.restaurantName,
      lines,
    };
    set(next);
    persist(next);
    get().syncToServer();
  },

  loadFromOrder: (input) => {
    // Reset cart entirely with fresh lineIds so quantity edits don't collide with prior lines.
    const lines = input.lines.map((l) => ({
      ...l,
      lineId: makeLineId(),
      restaurantId: input.restaurantId,
    }));
    const next = {
      restaurantId: input.restaurantId,
      restaurantName: input.restaurantName,
      lines,
    };
    set(next);
    persist(next);
    get().syncToServer();
  },

  updateLine: (lineId, patch) => {
    const current = get();
    const lines = current.lines.map((l) =>
      l.lineId === lineId
        ? {
            ...l,
            quantity: patch.quantity,
            modifierChoices: patch.modifierChoices,
            notes: patch.notes,
            allergens: patch.allergens,
          }
        : l,
    );
    const next = {
      restaurantId: current.restaurantId,
      restaurantName: current.restaurantName,
      lines,
    };
    set({ lines });
    persist(next);
    get().syncToServer();
  },

  setQuantity: (lineId, qty) => {
    const current = get();
    if (qty <= 0) {
      get().remove(lineId);
      return;
    }
    const lines = current.lines.map((l) => (l.lineId === lineId ? { ...l, quantity: qty } : l));
    const next = {
      restaurantId: current.restaurantId,
      restaurantName: current.restaurantName,
      lines,
    };
    set({ lines });
    persist(next);
    get().syncToServer();
  },

  remove: (lineId) => {
    const current = get();
    const lines = current.lines.filter((l) => l.lineId !== lineId);
    if (lines.length === 0) {
      set({ lines: [], restaurantId: null, restaurantName: null });
      persist({ lines: [], restaurantId: null, restaurantName: null });
      // An emptied basket is still a state worth mirroring: the other device
      // should not keep offering lines this customer just removed.
      get().syncToServer();
      return;
    }
    set({ lines });
    persist({ restaurantId: current.restaurantId, restaurantName: current.restaurantName, lines });
    get().syncToServer();
  },

  clear: () => {
    set({ lines: [], restaurantId: null, restaurantName: null });
    persist({ lines: [], restaurantId: null, restaurantName: null });
    // NOTE: no server call. See the interface comment — sign-out routes here and
    // must not delete the account's stored basket.
  },

  clearEverywhere: async () => {
    // Cancel any pending mirror first: letting a debounced write land after the
    // clear would recreate the row we are retiring.
    if (syncTimer) {
      clearTimeout(syncTimer);
      syncTimer = null;
    }
    syncDirty = false;
    syncEpoch += 1;
    serverClearInFlight = true;
    const pendingWrite = syncInFlightPromise;
    get().clear();
    set({ serverVersion: 0 });
    try {
      // An already-issued request cannot be cancelled. Wait for it, then clear
      // so its late commit cannot recreate the row after checkout/empty-cart.
      await pendingWrite?.catch(() => undefined);
      if (isBackendLive) await db.cart.clear();
    } catch {
      // Best-effort. clear_my_cart is idempotent, so the next successful sync or
      // placement retires the row; failing here must not block the customer,
      // whose order has already been placed by this point.
    } finally {
      serverClearInFlight = false;
      if (syncDirty) {
        syncDirty = false;
        get().syncToServer();
      }
    }
  },

  count: () => get().lines.reduce((acc, l) => acc + l.quantity, 0),

  subtotal: () => get().lines.reduce((acc, l) => acc + priceForLine(l), 0),

  serverVersion: 0,

  setServerVersion: (version) => set({ serverVersion: version }),

  adoptPrepared: (input) => {
    // Fresh lineIds for the same reason loadFromOrder does it: reused ids would
    // collide with existing lines during quantity edits.
    const lines = input.lines.map((l) => ({
      ...l,
      lineId: makeLineId(),
      restaurantId: input.restaurantId,
    }));
    const next = {
      restaurantId: input.restaurantId,
      restaurantName: input.restaurantName,
      lines,
    };
    set({ ...next, serverVersion: input.version });
    persist(next);
  },

  syncToServer: () => {
    if (!isBackendLive) return;

    if (syncInFlight || serverClearInFlight) {
      // Do not start a second write; note that state moved on and re-run after.
      syncDirty = true;
      return;
    }
    if (syncTimer) clearTimeout(syncTimer);

    syncTimer = setTimeout(() => {
      syncTimer = null;
      syncInFlight = true;
      const writeEpoch = syncEpoch;
      const operation = (async () => {
        try {
          const s = get();
          const expected = s.serverVersion;
          const res = await db.cart.upsert({
            restaurantId: s.restaurantId,
            lines: toServerLines(s.lines),
            expectedVersion: expected,
          });
          // A clear invalidates this response even though the request itself may
          // already have committed. clearEverywhere waits, then deletes it.
          if (writeEpoch !== syncEpoch) return;
          if (res.ok) {
            set({ serverVersion: res.version });
            track('cart_synced', { lineCount: s.lines.length, version: res.version });
          } else {
            // Another DEVICE wrote first. Do not overwrite it and do not silently
            // adopt it: the resolution belongs to the customer, and the sheet is
            // driven from the cart screen where they can see both baskets. Mark the
            // local version unknown so the next attempt re-reads rather than
            // repeating a write that cannot succeed.
            set({ serverVersion: -1 });
            track('cart_conflict_shown', { reason: 'version' });
          }
        } catch {
          // Offline or transient. The basket is intact locally and AsyncStorage
          // already holds it; the next mutation or app foreground retries.
        } finally {
          syncInFlight = false;
          if (syncDirty && !serverClearInFlight) {
            syncDirty = false;
            get().syncToServer();
          }
        }
      })();
      syncInFlightPromise = operation;
      void operation.then(() => {
        if (syncInFlightPromise === operation) syncInFlightPromise = null;
      });
    }, SYNC_DEBOUNCE_MS);
  },
}));
