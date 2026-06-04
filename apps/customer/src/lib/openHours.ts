import type { Restaurant } from '../data/types';

/**
 * Effective is-open check that layers cultural conventions on top of the
 * restaurant's static `isOpen` flag. Today this only handles the Egyptian
 * Friday prayer break (≈ 12:30–14:30 local) for non-24h venues whose cuisine
 * mix includes Egyptian street food, breakfast, or sit-down Egyptian food.
 *
 * Replace with a real per-restaurant `openHours` JSONB column when we wire
 * Supabase. Until then this is a heuristic that errs on the side of "open"
 * for tourist-safe venues.
 */
export function effectiveIsOpen(r: Restaurant, now: Date = new Date()): boolean {
  if (!r.isOpen) return false;
  if (r.isOpen24h) return true;

  // Friday is day 5 in JS (Sunday=0).
  const isFriday = now.getDay() === 5;
  if (!isFriday) return true;

  const minutes = now.getHours() * 60 + now.getMinutes();
  const friStart = 12 * 60 + 30; // 12:30
  const friEnd = 14 * 60 + 30; // 14:30
  if (minutes < friStart || minutes > friEnd) return true;

  // During the window, only close venues that locals would expect to close:
  // Egyptian street food, breakfast, traditional Egyptian. Tourist-leaning
  // venues stay open.
  const localCuisines: Restaurant['cuisines'] = ['street_food', 'breakfast', 'egyptian'];
  return !r.cuisines.some((c) => localCuisines.includes(c));
}

/** Reason text for the closed badge — UI may want to show "Friday prayer" instead of just "Closed". */
export function closedReasonKey(r: Restaurant, now: Date = new Date()): 'closed' | 'fridayPrayer' {
  if (!r.isOpen) return 'closed';
  const isFriday = now.getDay() === 5;
  if (!isFriday) return 'closed';
  const minutes = now.getHours() * 60 + now.getMinutes();
  if (minutes >= 12 * 60 + 30 && minutes <= 14 * 60 + 30) return 'fridayPrayer';
  return 'closed';
}
