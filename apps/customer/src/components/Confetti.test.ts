import { describe, it, expect, vi } from 'vitest';
vi.mock('react-native', () => ({ StyleSheet: { create: (s: unknown) => s }, View: 'View', Dimensions: { get: () => ({ width: 390 }) } }));
vi.mock('react-native-reanimated', () => ({ default: { View: 'AV' }, useSharedValue: (v: number) => ({ value: v }), useAnimatedStyle: (f: () => unknown) => f(), withTiming: (v: number) => v, withDelay: (_d: number, v: number) => v }));

import { buildParticles } from './Confetti';

describe('buildParticles — deterministic particle spread', () => {
  it('returns exactly `count` particles', () => {
    expect(buildParticles(14, ['#a', '#b'])).toHaveLength(14);
  });
  it('cycles through the provided colors', () => {
    const ps = buildParticles(4, ['#a', '#b']);
    expect(ps.map((p) => p.color)).toEqual(['#a', '#b', '#a', '#b']);
  });
  it('spreads angles across 0..360', () => {
    const ps = buildParticles(8, ['#a']);
    expect(ps[0].angle).toBe(0);
    expect(ps[ps.length - 1].angle).toBeLessThan(360);
  });
});
