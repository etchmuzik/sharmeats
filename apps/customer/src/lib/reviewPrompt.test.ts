/** Review-prompt frequency policy (Package 05 Slice F). */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const storage = new Map<string, string>();
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn((k: string) => Promise.resolve(storage.get(k) ?? null)),
    setItem: vi.fn((k: string, v: string) => { storage.set(k, v); return Promise.resolve(); }),
  },
}));
vi.mock('expo-constants', () => ({ default: { expoConfig: { version: '1.2.0' } } }));

import { recordReviewPrompt, reviewPromptEligibility } from './reviewPrompt';

beforeEach(() => storage.clear());

describe('reviewPromptEligibility', () => {
  it('a fresh install is eligible', async () => {
    expect(await reviewPromptEligibility()).toEqual({ eligible: true });
  });

  it('cooldown: a recent prompt suppresses the next one', async () => {
    await recordReviewPrompt();
    expect(await reviewPromptEligibility()).toEqual({ eligible: false, reason: 'cooldown' });
  });

  it('after the cooldown, the SAME app version still suppresses', async () => {
    storage.set('@sharmeats:reviewPrompt:v1', JSON.stringify({
      lastPromptedAt: new Date(Date.now() - 90 * 86_400_000).toISOString(),
      promptCount: 1, lastVersion: '1.2.0',
    }));
    expect(await reviewPromptEligibility()).toEqual({ eligible: false, reason: 'same_version' });
  });

  it('a NEW version after the cooldown is a fair new ask', async () => {
    storage.set('@sharmeats:reviewPrompt:v1', JSON.stringify({
      lastPromptedAt: new Date(Date.now() - 90 * 86_400_000).toISOString(),
      promptCount: 1, lastVersion: '1.1.0',
    }));
    expect(await reviewPromptEligibility()).toEqual({ eligible: true });
  });

  it('the lifetime cap ends the asking forever', async () => {
    storage.set('@sharmeats:reviewPrompt:v1', JSON.stringify({
      lastPromptedAt: new Date(Date.now() - 900 * 86_400_000).toISOString(),
      promptCount: 3, lastVersion: '0.9.0',
    }));
    expect(await reviewPromptEligibility()).toEqual({ eligible: false, reason: 'lifetime_cap' });
  });

  it('corrupt state degrades to eligible (the OS still throttles)', async () => {
    storage.set('@sharmeats:reviewPrompt:v1', '{corrupt');
    expect(await reviewPromptEligibility()).toEqual({ eligible: true });
  });
});
