import { describe, it, expect } from 'vitest';
import { getPose } from './poses';

describe('getPose — per-pose SVG params', () => {
  it('cheer has a big open smile and bigger rays', () => {
    const p = getPose('cheer');
    expect(p.rayScale).toBeGreaterThan(getPose('idle').rayScale);
    expect(p.mouthPath.length).toBeGreaterThan(0);
  });
  it('snooze narrows the eyes (small eyeRy)', () => {
    expect(getPose('snooze').eyeRy).toBeLessThan(getPose('idle').eyeRy);
  });
  it('shrug droops the rays (rotate negative or scale < idle)', () => {
    expect(getPose('shrug').rayScale).toBeLessThanOrEqual(getPose('idle').rayScale);
  });
  it('returns idle params for idle', () => {
    expect(getPose('idle')).toBeDefined();
  });
});
