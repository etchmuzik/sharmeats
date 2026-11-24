import type { Lang } from './routes';
import references from './restaurant-references.json';

// Snapshot of ordinary customer-visible food listings, 2026-11-24. Each entry
// matched a venue in the sourced restaurant directory. Legacy "live" records
// establish catalog presence, not merchant sign-off on prices or delivery.
export const restaurantReferences = references;
export const referenceDate = '2026-11-24';
export const catalogAreas = [
  { zone: 'naama', anchor: 'naama-bay', guide: true, ru: 'Наама-Бей' },
  { zone: 'hadaba', anchor: 'hadaba', guide: true, ru: 'Хадаба' },
  { zone: 'nabq', anchor: 'nabq-bay', guide: true, ru: 'Набк-Бей' },
  { zone: 'old_market', anchor: 'old-market', guide: false, ru: 'Старый рынок' },
  { zone: 'soho', anchor: 'soho-square', guide: false, ru: 'Площадь Сохо' },
  { zone: 'sharks_bay', anchor: 'sharks-bay', guide: false, ru: 'Шаркс-Бей' },
  { zone: 'hay_el_nour', anchor: 'hay-el-nour', guide: false, ru: 'Хай-эль-Нур' },
] as const;

// Merchant-operated links for the local branch. These are venue menus.
export const restaurantMenuLinks: Readonly<Record<string, string>> = {
  pomodoro: 'https://www.cameldive.com/food-and-drinks-pomodoro-restaurant/pomodoro-dinner-menu/',
  'hard-rock-cafe-sharm-el-sheikh': 'https://cafe.hardrock.com/Sharm-el-Sheikh/',
  'zen-chinese-restaurant': 'https://www.soho-sharm.com/zen',
};

type LocalizedName = Record<Lang, string>;
export interface DeliveryMenu {
  slug: string;
  restaurantName: string;
  verifiedOn: string;
  sourceUrl: string;
  dishes: readonly { name: LocalizedName; priceEgp: number }[];
}

// Add a branch only when its operator has confirmed the delivery menu,
// prices and publication permission. A venue's dine-in menu can differ.
export const publishedDeliveryMenus: readonly DeliveryMenu[] = [];
