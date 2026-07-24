import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const rpc = vi.fn();
  const getUser = vi.fn();
  return {
    rpc,
    getUser,
    supabase: {
      auth: { getUser },
      rpc,
      from: vi.fn(),
    },
  };
});

vi.mock('./client', () => ({
  getSupabase: () => mocks.supabase,
}));

import { userRepoSupabase } from './user';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getUser.mockResolvedValue({ data: { user: { id: 'user-1' } } });
  mocks.rpc.mockResolvedValue({ error: null });
});

describe('push token ownership', () => {
  it('registers through the server-authoritative token transfer RPC', async () => {
    await userRepoSupabase.registerPushToken('ExponentPushToken[test-device]', 'android');

    expect(mocks.rpc).toHaveBeenCalledWith('register_push_token', {
      p_token: 'ExponentPushToken[test-device]',
      p_platform: 'android',
    });
  });
});
