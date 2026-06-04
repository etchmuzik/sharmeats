import { HOTELS } from '../mock/hotels';
import type { Hotel } from '../types';

const delay = <T>(value: T, ms = 40): Promise<T> =>
  new Promise((resolve) => setTimeout(() => resolve(value), ms));

export const hotelsRepo = {
  async list(): Promise<Hotel[]> {
    return delay(HOTELS);
  },

  async search(query: string): Promise<Hotel[]> {
    const q = query.toLowerCase().trim();
    if (!q) return delay(HOTELS);
    return delay(
      HOTELS.filter(
        (h) => h.name.toLowerCase().includes(q) || (h.brand?.toLowerCase().includes(q) ?? false),
      ),
    );
  },

  async get(id: string): Promise<Hotel | null> {
    return delay(HOTELS.find((h) => h.id === id) ?? null);
  },
};
