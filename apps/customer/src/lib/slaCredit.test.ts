import { describe, it, expect } from 'vitest';
import { slaCreditEgp, SLA_CREDIT_MAX_EGP, SLA_CREDIT_PCT } from './slaCredit';

// Mirrors migration 062's engine: least(100, floor(subtotal_egp * 10 / 100)).
// The displayed number must never exceed what the server actually credits.
describe('slaCreditEgp — matches the server SLA credit engine', () => {
  it('credits 10% of the subtotal', () => {
    expect(slaCreditEgp(500)).toBe(50);
    expect(slaCreditEgp(200)).toBe(20);
  });

  it('floors instead of rounding (555 → 55, not 56)', () => {
    expect(slaCreditEgp(555)).toBe(55);
    expect(slaCreditEgp(559)).toBe(55);
  });

  it('caps at 100 EGP for large subtotals', () => {
    expect(slaCreditEgp(1500)).toBe(SLA_CREDIT_MAX_EGP);
    expect(slaCreditEgp(1000)).toBe(100);
    expect(slaCreditEgp(999)).toBe(99);
  });

  it('handles zero and tiny subtotals', () => {
    expect(slaCreditEgp(0)).toBe(0);
    expect(slaCreditEgp(9)).toBe(0);
    expect(slaCreditEgp(10)).toBe(1);
  });

  it('exposes constants that mirror the seeded platform_settings defaults', () => {
    expect(SLA_CREDIT_PCT).toBe(10);
    expect(SLA_CREDIT_MAX_EGP).toBe(100);
  });
});
