import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { AllergyKey, CartItem, CartItemModifierChoice } from '../data/types';

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
  clear: () => void;
  count: () => number;
  subtotal: () => number;
}

function persist(state: Pick<CartState, 'restaurantId' | 'restaurantName' | 'lines'>) {
  AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(state)).catch(() => {});
}

function makeLineId(): string {
  return `l-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

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
  },

  remove: (lineId) => {
    const current = get();
    const lines = current.lines.filter((l) => l.lineId !== lineId);
    if (lines.length === 0) {
      set({ lines: [], restaurantId: null, restaurantName: null });
      persist({ lines: [], restaurantId: null, restaurantName: null });
      return;
    }
    set({ lines });
    persist({ restaurantId: current.restaurantId, restaurantName: current.restaurantName, lines });
  },

  clear: () => {
    set({ lines: [], restaurantId: null, restaurantName: null });
    persist({ lines: [], restaurantId: null, restaurantName: null });
  },

  count: () => get().lines.reduce((acc, l) => acc + l.quantity, 0),

  subtotal: () => get().lines.reduce((acc, l) => acc + priceForLine(l), 0),
}));
