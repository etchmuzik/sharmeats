import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ value: null as string | null }));
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn(async () => h.value),
    setItem: vi.fn(async (_key: string, value: string) => {
      h.value = value;
    }),
  },
}));

import { ensurePresenceDisclosure } from './presenceDisclosure';

describe('background presence disclosure', () => {
  beforeEach(() => {
    h.value = null;
  });

  it('does not remember consent when the driver declines', async () => {
    expect(await ensurePresenceDisclosure(async () => false)).toBe(false);
    expect(h.value).toBeNull();
  });

  it('shows once, persists acceptance, and does not nag on future shifts', async () => {
    const show = vi.fn(async () => true);
    expect(await ensurePresenceDisclosure(show)).toBe(true);
    expect(await ensurePresenceDisclosure(show)).toBe(true);
    expect(show).toHaveBeenCalledTimes(1);
  });
});
