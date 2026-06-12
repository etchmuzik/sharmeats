import { RESTAURANTS } from '../mock/restaurants';
import type { Cuisine, Restaurant, Review } from '../types';

// Canned review pool for mock mode — sliced deterministically per restaurant
// so the same venue always shows the same reviews.
const REVIEW_POOL: Omit<Review, 'reviewedAt'>[] = [
  { ratingFood: 5, ratingDelivery: 5, reviewer: 'Lena M.', comment: 'Food arrived hot all the way to our hotel room. Perfect.' },
  { ratingFood: 5, ratingDelivery: 4, reviewer: 'Ahmed S.', comment: 'أكل ممتاز والتوصيل سريع.' },
  { ratingFood: 4, ratingDelivery: 5, reviewer: 'Guest', comment: 'Driver found our beach spot from the pin, impressive.' },
  { ratingFood: 5, ratingDelivery: 5, reviewer: 'Olga K.', comment: 'Ordered twice this week. Consistent and fresh.' },
  { ratingFood: 4, ratingDelivery: 4, reviewer: 'Marco R.', comment: 'Great portions, fair price.' },
  { ratingFood: 5, ratingDelivery: 3, reviewer: 'Sara T.', comment: 'Delicious — delivery took a bit longer at iftar time.' },
  { ratingFood: 4, ratingDelivery: 5, reviewer: 'Guest' },
  { ratingFood: 5, ratingDelivery: 5, reviewer: 'Yara H.', comment: 'الكشري هنا أحسن من القاهرة، بجد.' },
];

function hashCode(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i += 1) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

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

  /** Mock reviews — deterministic per restaurant (live mode uses get_restaurant_reviews). */
  async reviews(restaurantId: string, limit = 20): Promise<Review[]> {
    const seed = hashCode(restaurantId);
    const count = 3 + (seed % 4); // 3–6 reviews
    const start = seed % REVIEW_POOL.length;
    const out: Review[] = [];
    for (let i = 0; i < count && i < limit; i += 1) {
      const base = REVIEW_POOL[(start + i) % REVIEW_POOL.length];
      out.push({ ...base, reviewedAt: Date.now() - (i + 1) * 36e5 * 26 });
    }
    return delay(out);
  },
};
