import { describe, expect, it } from 'vitest';
import { onboardingHeroHeight } from './onboardingLayout';

describe('onboardingHeroHeight', () => {
  it('caps a tall viewport at the art-directed maximum', () => {
    expect(onboardingHeroHeight(1_200)).toBe(460);
  });

  it('keeps enough visual context on a short viewport', () => {
    expect(onboardingHeroHeight(568)).toBe(273);
  });

  it('never falls below the minimum usable hero height', () => {
    expect(onboardingHeroHeight(300)).toBe(260);
  });
});
