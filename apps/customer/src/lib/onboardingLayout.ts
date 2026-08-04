const HERO_MIN_HEIGHT = 260;
const HERO_MAX_HEIGHT = 460;
const HERO_VIEWPORT_RATIO = 0.48;

/**
 * Keeps the artwork prominent without forcing the onboarding CTA below a
 * compact viewport. The slide itself remains vertically scrollable for larger
 * Dynamic Type settings.
 */
export function onboardingHeroHeight(viewportHeight: number): number {
  const safeHeight = Number.isFinite(viewportHeight) ? Math.max(0, viewportHeight) : HERO_MIN_HEIGHT;
  const scaledHeight = Math.round(safeHeight * HERO_VIEWPORT_RATIO);
  return Math.min(HERO_MAX_HEIGHT, Math.max(HERO_MIN_HEIGHT, scaledHeight));
}
