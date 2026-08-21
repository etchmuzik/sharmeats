import type { Vertical } from '../types';

/**
 * Mock backend: a food-only world, matching the mock catalog. The tile row
 * renders nothing with a single vertical, so mock mode looks like production
 * does for a public (non-pilot) account.
 */
export const verticalsRepo = {
  async list(): Promise<Vertical[]> {
    return [{ id: 'food', nameEn: 'Food', nameAr: 'طعام', icon: 'utensils' }];
  },
};
