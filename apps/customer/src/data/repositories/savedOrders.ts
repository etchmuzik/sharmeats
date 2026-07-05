import type { CartItem, SavedOrder } from '../types';

export const SAVED_ORDERS_CAP = 5;

export class SavedOrdersCapError extends Error {
  constructor() {
    super(`Cannot save more than ${SAVED_ORDERS_CAP} orders`);
    this.name = 'SavedOrdersCapError';
  }
}

const delay = <T>(value: T, ms = 40): Promise<T> =>
  new Promise((resolve) => setTimeout(() => resolve(value), ms));

// Mutable in-memory store so saves stick during a mock session, mirroring the
// live adapter's contract. Reset between tests via __resetSavedOrders.
let saved: SavedOrder[] = [];

let seq = 0;
function makeId(): string {
  seq += 1;
  return `so-mock-${seq}`;
}

export interface SaveSavedOrderInput {
  restaurantId: string;
  restaurantName: string;
  name: string;
  items: CartItem[];
}

export const savedOrdersRepo = {
  /** Newest first. */
  async list(): Promise<SavedOrder[]> {
    return delay([...saved].sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
  },

  async save(input: SaveSavedOrderInput): Promise<SavedOrder> {
    if (saved.length >= SAVED_ORDERS_CAP) throw new SavedOrdersCapError();
    // Monotonic timestamp so newest-first ordering is stable even for saves in
    // the same millisecond (test saves two in a row).
    const createdAt = new Date(Date.now() + seq).toISOString();
    const record: SavedOrder = {
      id: makeId(),
      restaurantId: input.restaurantId,
      restaurantName: input.restaurantName,
      name: input.name,
      items: input.items,
      createdAt,
    };
    saved = [record, ...saved];
    return delay(record);
  },

  async remove(id: string): Promise<void> {
    saved = saved.filter((s) => s.id !== id);
    return delay(undefined);
  },
};

/** Test-only: clear the in-memory store. */
export function __resetSavedOrders(): void {
  saved = [];
  seq = 0;
}
