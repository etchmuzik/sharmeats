/**
 * The duplicate-COD-order rule.
 *
 * The old key lived in a `useRef`, so it was stable only within one mount of the
 * checkout screen. The failure path deliberately keeps the cart, so the natural
 * recovery from a timed-out "Place order" — back out, re-enter, tap again —
 * regenerated the key and let `place_order` treat a retry as a brand-new order:
 * two kitchen tickets, two drivers, two cash collections for one meal.
 *
 * These pin the two properties that make a retry safe:
 *   - the SAME basket produces the SAME fingerprint (so the key is reused), and
 *   - a genuinely DIFFERENT basket produces a different one (so a second, real
 *     order is never deduplicated away).
 */
import { describe, it, expect } from 'vitest';
import { cartFingerprint, makeIdempotencyKey, reusableKey } from './checkoutIdempotency';
import type { CartItem } from '../data/types';

function line(over: Partial<CartItem> = {}): CartItem {
  return {
    lineId: 'l-1',
    itemId: 'i-1',
    restaurantId: 'r-1',
    name: 'Koshari',
    basePriceEgp: 60,
    image: '',
    quantity: 1,
    modifierChoices: [],
    ...over,
  };
}

describe('cartFingerprint — the same basket is the same order attempt', () => {
  it('is stable across separate calls with equal contents', () => {
    const a = cartFingerprint('r-1', [line()]);
    const b = cartFingerprint('r-1', [line({ lineId: 'l-different' })]);
    // lineId is a local render id, not part of what the customer ordered.
    expect(a).toBe(b);
  });

  it('ignores price — a menu price change is not a different order', () => {
    expect(cartFingerprint('r-1', [line({ basePriceEgp: 60 })])).toBe(
      cartFingerprint('r-1', [line({ basePriceEgp: 75 })]),
    );
  });

  it('ignores modifier ORDER within a line (not customer-visible)', () => {
    const one = cartFingerprint('r-1', [
      line({
        modifierChoices: [
          { modifierId: 'g', modifierName: 'G', optionId: 'a', optionName: 'A', priceDeltaEgp: 0 },
          { modifierId: 'g', modifierName: 'G', optionId: 'b', optionName: 'B', priceDeltaEgp: 0 },
        ],
      }),
    ]);
    const two = cartFingerprint('r-1', [
      line({
        modifierChoices: [
          { modifierId: 'g', modifierName: 'G', optionId: 'b', optionName: 'B', priceDeltaEgp: 0 },
          { modifierId: 'g', modifierName: 'G', optionId: 'a', optionName: 'A', priceDeltaEgp: 0 },
        ],
      }),
    ]);
    expect(one).toBe(two);
  });

  it('changes when the quantity changes', () => {
    expect(cartFingerprint('r-1', [line({ quantity: 1 })])).not.toBe(
      cartFingerprint('r-1', [line({ quantity: 2 })]),
    );
  });

  it('changes when an item is added', () => {
    expect(cartFingerprint('r-1', [line()])).not.toBe(
      cartFingerprint('r-1', [line(), line({ itemId: 'i-2' })]),
    );
  });

  it('changes when the restaurant changes', () => {
    expect(cartFingerprint('r-1', [line()])).not.toBe(cartFingerprint('r-2', [line()]));
  });

  it('changes when the allergen selection changes — a different briefing is a different order', () => {
    expect(cartFingerprint('r-1', [line({ allergens: ['nuts'] })])).not.toBe(
      cartFingerprint('r-1', [line({ allergens: ['nuts', 'dairy'] })]),
    );
  });
});

describe('reusableKey — a stored key is reused only for the basket that minted it', () => {
  const fp = cartFingerprint('r-1', [line()]);

  it('reuses the key for the same basket (this is the whole point)', () => {
    expect(reusableKey({ fingerprint: fp, key: 'k-1' }, fp)).toBe('k-1');
  });

  it('refuses a key minted for a different basket', () => {
    expect(reusableKey({ fingerprint: 'other', key: 'k-1' }, fp)).toBeNull();
  });

  it('refuses missing or malformed storage rather than sending a bogus key', () => {
    expect(reusableKey(null, fp)).toBeNull();
    expect(reusableKey({ fingerprint: fp, key: '' }, fp)).toBeNull();
    expect(reusableKey({ fingerprint: fp } as never, fp)).toBeNull();
  });
});

describe('makeIdempotencyKey', () => {
  it('produces a uuid-shaped value — p_idempotency_key is typed uuid', () => {
    expect(makeIdempotencyKey()).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
  });

  it('does not repeat itself', () => {
    expect(makeIdempotencyKey()).not.toBe(makeIdempotencyKey());
  });
});
