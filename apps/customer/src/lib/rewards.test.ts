import { describe, it, expect } from 'vitest';
import { starterFloorPct, STARTER_FILL_PCT } from './rewards';

describe('starterFloorPct — visual-only tier-bar floor', () => {
  it('floors a zero real percentage up to the starter fill', () => {
    expect(starterFloorPct(0)).toBe(STARTER_FILL_PCT);
  });

  it('leaves a real percentage above the floor unchanged', () => {
    expect(starterFloorPct(42)).toBe(42);
  });

  it('returns the floor when the real percentage is just below it', () => {
    expect(starterFloorPct(STARTER_FILL_PCT - 1)).toBe(STARTER_FILL_PCT);
  });

  it('never exceeds 100', () => {
    expect(starterFloorPct(140)).toBe(100);
  });

  it('is exactly the floor at the boundary', () => {
    expect(starterFloorPct(STARTER_FILL_PCT)).toBe(STARTER_FILL_PCT);
  });
});
