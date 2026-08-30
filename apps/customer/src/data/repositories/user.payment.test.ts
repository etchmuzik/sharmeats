import { afterEach, describe, expect, it, vi } from 'vitest';

async function loadCashOnlyUserRepo() {
  vi.resetModules();
  vi.stubEnv('EXPO_PUBLIC_PAYMENTS_CARD_ENABLED', 'false');
  const { userRepo } = await import('./user');
  await userRepo.deleteAccount();
  return userRepo;
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('cash-only saved payment methods', () => {
  it('filters persisted card and wallet fixtures to exactly the COD option shown to the picker', async () => {
    const userRepo = await loadCashOnlyUserRepo();

    await expect(userRepo.listPaymentMethods()).resolves.toEqual([
      expect.objectContaining({ id: 'pm-cash', kind: 'cash' }),
    ]);
  });
});
