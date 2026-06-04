import { RESTAURANTS } from '../mock/restaurants';
import type { Cuisine, Restaurant } from '../types';

const delay = <T>(value: T, ms = 80): Promise<T> =>
  new Promise((resolve) => setTimeout(() => resolve(value), ms));

export const restaurantsRepo = {
  async list(filter?: { cuisine?: Cuisine; query?: string }): Promise<Restaurant[]> {
    let out = RESTAURANTS;
    if (filter?.cuisine) {
      out = out.filter((r) => r.cuisines.includes(filter.cuisine!));
    }
    if (filter?.query) {
      const q = filter.query.toLowerCase();
      out = out.filter(
        (r) => r.name.toLowerCase().includes(q) || r.cuisineLabel.toLowerCase().includes(q),
      );
    }
    return delay(out);
  },

  async listFeatured(): Promise<Restaurant[]> {
    return delay(RESTAURANTS.filter((r) => r.featured));
  },

  async get(id: string): Promise<Restaurant | null> {
    return delay(RESTAURANTS.find((r) => r.id === id) ?? null);
  },

  async getBySlug(slug: string): Promise<Restaurant | null> {
    return delay(RESTAURANTS.find((r) => r.slug === slug) ?? null);
  },
};
