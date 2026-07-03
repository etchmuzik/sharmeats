import { describe, it, expect } from 'vitest';
import { rewardsRepo } from './rewards';

// The rewards mock repo holds a module-level credit balance (demo starts at 50
// EGP). redeemCredit mutates it, so these tests read the live balance before
// each assertion rather than hard-coding a value, keeping them order-independent.

describe('rewardsRepo.getCreditBalanceEgp — reports the demo wallet credit', () => {
  it('returns a non-negative number', async () => {
    const balance = await rewardsRepo.getCreditBalanceEgp();
    expect(typeof balance).toBe('number');
    expect(balance).toBeGreaterThanOrEqual(0);
  });
});

describe('rewardsRepo.redeemCredit — happy path', () => {
  it('reduces the balance by the redeemed amount and returns a code', async () => {
    const before = await rewardsRepo.getCreditBalanceEgp();
    // Redeem a small slice we know is available (balance starts at 50).
    const amount = 10;
    expect(before).toBeGreaterThanOrEqual(amount);

    const code = await rewardsRepo.redeemCredit(amount);
    expect(typeof code).toBe('string');
    expect(code.length).toBeGreaterThan(0);

    const after = await rewardsRepo.getCreditBalanceEgp();
    expect(after).toBe(before - amount);
  });
});

describe('rewardsRepo.redeemCredit — validation guards', () => {
  it('throws INSUFFICIENT_CREDIT when redeeming more than the balance', async () => {
    const balance = await rewardsRepo.getCreditBalanceEgp();
    await expect(rewardsRepo.redeemCredit(balance + 1)).rejects.toThrow('INSUFFICIENT_CREDIT');
  });

  it('does not change the balance on an over-redeem attempt', async () => {
    const before = await rewardsRepo.getCreditBalanceEgp();
    await expect(rewardsRepo.redeemCredit(before + 100)).rejects.toThrow();
    const after = await rewardsRepo.getCreditBalanceEgp();
    expect(after).toBe(before);
  });

  it('throws INVALID_AMOUNT for a zero amount', async () => {
    await expect(rewardsRepo.redeemCredit(0)).rejects.toThrow('INVALID_AMOUNT');
  });

  it('throws INVALID_AMOUNT for a negative amount', async () => {
    await expect(rewardsRepo.redeemCredit(-5)).rejects.toThrow('INVALID_AMOUNT');
  });
});
