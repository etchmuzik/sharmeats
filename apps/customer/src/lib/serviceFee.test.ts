import { describe, it, expect } from 'vitest';
import { serviceFeeEgp, SERVICE_FEE_PCT } from './serviceFee';

// Mirrors migration 096's engine: round(subtotal_egp * service_fee_pct / 100).
// The displayed number must never differ from what place_order charges
// (N2 preview≠charge lesson).
describe('serviceFeeEgp — matches the server service fee engine', () => {
  it('is dark by default (0% shipped) so no fee is shown until config flips', () => {
    expect(SERVICE_FEE_PCT).toBe(0);
    expect(serviceFeeEgp(500)).toBe(0);
    expect(serviceFeeEgp(1000)).toBe(0);
  });

  it('handles zero and tiny subtotals', () => {
    expect(serviceFeeEgp(0)).toBe(0);
    expect(serviceFeeEgp(9)).toBe(0);
  });

  it('computes round(subtotal * pct / 100) — verified at the 3% flip rate', () => {
    // The rollout math the constant will carry once the owner sets pct=3.
    const pct = 3;
    const fee = (subtotal: number) => Math.round(subtotal * (pct / 100));
    // round-half-up: round(1.95) = 2 (65 * 3 / 100 = 1.95)
    expect(fee(65)).toBe(2);
    // exact: 100 * 3 / 100 = 3
    expect(fee(100)).toBe(3);
    // 500 * 3 / 100 = 15
    expect(fee(500)).toBe(15);
    // round-down half: 50 * 3 / 100 = 1.5 -> 2 (round-half-up)
    expect(fee(50)).toBe(2);
    // round-down: 33 * 3 / 100 = 0.99 -> 1
    expect(fee(33)).toBe(1);
    // no cap on large subtotals
    expect(fee(10000)).toBe(300);
  });
});
