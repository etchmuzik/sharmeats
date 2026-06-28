import { describe, it, expect } from 'vitest';
import {
  lineTotalEgp,
  subtotalEgp,
  deliveryFeeEgp,
  orderTotalEgp,
} from './fees';

// These mirror the money math in place_order (mig 011/019/028/031). They are an
// ESTIMATE only — the server always recomputes — but the estimate must match so
// the customer isn't surprised at checkout.

describe('line + subtotal', () => {
  it('line total = (base + modifiers) * qty', () => {
    expect(lineTotalEgp({ basePriceEgp: 100, modifierDeltaEgp: 20, quantity: 2 })).toBe(240);
  });

  it('subtotal sums all lines', () => {
    expect(
      subtotalEgp([
        { basePriceEgp: 100, modifierDeltaEgp: 0, quantity: 1 },
        { basePriceEgp: 50, modifierDeltaEgp: 10, quantity: 3 },
      ]),
    ).toBe(100 + 180);
  });
});

describe('delivery fee', () => {
  it('is the base fee when nothing else applies', () => {
    expect(deliveryFeeEgp(200, { baseFeeEgp: 30 })).toBe(30);
  });

  it('is free over the free-delivery threshold', () => {
    expect(deliveryFeeEgp(500, { baseFeeEgp: 30, freeOverEgp: 400 })).toBe(0);
  });

  it('respects the minimum fee floor', () => {
    expect(deliveryFeeEgp(100, { baseFeeEgp: 10, minFeeEgp: 25 })).toBe(25);
  });

  it('adds the distance component', () => {
    expect(deliveryFeeEgp(100, { baseFeeEgp: 20, perKmFeeEgp: 5, distanceKm: 3 })).toBe(35);
  });
});

describe('order total', () => {
  it('sums subtotal + delivery + tax + tip - discount', () => {
    expect(
      orderTotalEgp({ subtotalEgp: 200, deliveryFeeEgp: 30, taxEgp: 0, tipEgp: 15, discountEgp: 20 }),
    ).toBe(225);
  });

  it('never goes below zero', () => {
    expect(
      orderTotalEgp({ subtotalEgp: 50, deliveryFeeEgp: 0, discountEgp: 100 }),
    ).toBe(0);
  });
});
