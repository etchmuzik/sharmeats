import { describe, expect, it } from 'vitest';
import { nextBrandFilterReset } from './brandFilter';

const smash = { id: 'o1', restaurant_id: 'smash' };
const pizza = { id: 'o2', restaurant_id: 'pizza' };

describe('multi-brand filter auto-reset', () => {
  it('snaps back to All for a ticket the operator has not been shown', () => {
    const { reset, seen } = nextBrandFilterReset('smash', [pizza], new Set());
    expect(reset).toBe(true);
    expect(seen.has('o2')).toBe(true);
  });

  it('does NOT re-lock the filter for a ticket that is merely still waiting', () => {
    // The bug: the old check was stateless, so any brand with an outstanding
    // order bounced the filter back to All on every render and made it unusable.
    const first = nextBrandFilterReset('all', [pizza], new Set());
    expect(first.reset).toBe(false);
    const second = nextBrandFilterReset('smash', [pizza], first.seen);
    expect(second.reset).toBe(false);
    const third = nextBrandFilterReset('smash', [pizza], second.seen);
    expect(third.reset).toBe(false);
  });

  it('still fires for a genuinely NEW ticket after the filter settled', () => {
    const settled = nextBrandFilterReset('smash', [pizza], new Set(['o2']));
    expect(settled.reset).toBe(false);
    const arrival = nextBrandFilterReset(
      'smash',
      [pizza, { id: 'o3', restaurant_id: 'pizza' }],
      settled.seen,
    );
    expect(arrival.reset).toBe(true);
  });

  it('never resets while the filter is already All', () => {
    expect(nextBrandFilterReset('all', [smash, pizza], new Set()).reset).toBe(false);
  });

  it('ignores a new ticket for the brand already being shown', () => {
    expect(nextBrandFilterReset('smash', [smash], new Set()).reset).toBe(false);
  });

  it('prunes ids of tickets that have left the unaccepted set', () => {
    const { seen } = nextBrandFilterReset('all', [smash], new Set(['o2', 'o9']));
    expect([...seen]).toEqual(['o1']);
  });
});
