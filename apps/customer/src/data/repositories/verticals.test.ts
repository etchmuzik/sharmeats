import { describe, expect, it } from 'vitest';
import { verticalsRepo } from './verticals';

describe('verticalsRepo (mock backend)', () => {
  it('is a food-only world, so the home tile row stays hidden in mock mode', async () => {
    // VerticalTiles renders nothing below two verticals. Mock mode must look
    // like production does for a public (non-pilot) account; a second vertical
    // sneaking into the mock would silently un-hide the switcher in every
    // dev/test environment.
    const out = await verticalsRepo.list();
    expect(out.map((v) => v.id)).toEqual(['food']);
  });
});
