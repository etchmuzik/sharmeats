import { describe, expect, it, vi } from 'vitest';

import { loadOnboardingQueue } from './onboardingQueue';

const submittedRow = {
  id: 'restaurant-1',
  name: 'Submitted Kitchen',
  zone: 'Naama Bay',
  phone: '+20-100',
  created_at: '2026-08-29T10:00:00.000Z',
  onboarding_status: 'submitted' as const,
  onboarding_rejection_reason: null,
  commission_pct: 12.5,
};

describe('loadOnboardingQueue', () => {
  it('uses the MFA-gated exact-projection RPC instead of a direct restaurants query', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: [submittedRow], error: null });

    await expect(loadOnboardingQueue({ rpc }, 'submitted')).resolves.toEqual({
      data: [submittedRow],
      error: null,
    });
    expect(rpc).toHaveBeenCalledOnce();
    expect(rpc).toHaveBeenCalledWith('admin_onboarding_queue', { p_status: 'submitted' });
  });

  it('keeps a queue RPC failure visible to the page instead of showing an empty queue', async () => {
    const failure = new Error('MFA_REQUIRED');
    const rpc = vi.fn().mockResolvedValue({ data: null, error: failure });

    await expect(loadOnboardingQueue({ rpc }, 'rejected')).resolves.toEqual({
      data: [],
      error: failure,
    });
    expect(rpc).toHaveBeenCalledWith('admin_onboarding_queue', { p_status: 'rejected' });
  });
});
