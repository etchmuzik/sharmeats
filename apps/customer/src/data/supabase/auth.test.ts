import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const storage = new Map<string, string>();
  const asyncStorage = {
    getItem: vi.fn(async (key: string) => storage.get(key) ?? null),
    setItem: vi.fn(async (key: string, value: string) => {
      storage.set(key, value);
    }),
    removeItem: vi.fn(async (key: string) => {
      storage.delete(key);
    }),
  };
  const auth = {
    getSession: vi.fn(),
    getUser: vi.fn(),
    updateUser: vi.fn(),
    signInWithOtp: vi.fn(),
    verifyOtp: vi.fn(),
    signInAnonymously: vi.fn(),
    signOut: vi.fn(),
  };
  const profileEq = vi.fn(async () => ({ error: null }));
  const profileUpdate = vi.fn(() => ({ eq: profileEq }));
  const supabase = {
    auth,
    from: vi.fn(() => ({ update: profileUpdate })),
  };
  return { storage, asyncStorage, auth, profileEq, profileUpdate, supabase };
});

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: mocks.asyncStorage,
}));

vi.mock('./client', () => ({
  getSupabase: () => mocks.supabase,
}));

import { authRepoSupabase } from './auth';

async function loadRepo() {
  return authRepoSupabase;
}

beforeEach(() => {
  mocks.storage.clear();
  vi.clearAllMocks();
  mocks.auth.getUser.mockResolvedValue({ data: { user: null } });
  mocks.auth.signInAnonymously.mockResolvedValue({ data: { user: null }, error: null });
  mocks.auth.signOut.mockResolvedValue({ error: null });
  mocks.profileEq.mockResolvedValue({ error: null });
});

describe('Supabase OTP flow persistence', () => {
  it('persists a phone-change flow before leaving the anonymous session', async () => {
    mocks.auth.getSession.mockResolvedValue({
      data: { session: { user: { id: 'guest-1', is_anonymous: true } } },
    });
    mocks.auth.updateUser.mockResolvedValue({ error: null });

    const repo = await loadRepo();
    await repo.sendOtp('+201001234567');

    expect(mocks.auth.updateUser).toHaveBeenCalledWith({ phone: '+201001234567' });
    expect(mocks.asyncStorage.setItem).toHaveBeenCalledOnce();
    const persisted = JSON.parse([...mocks.storage.values()][0]);
    expect(persisted).toMatchObject({
      type: 'phone_change',
      phone: '+201001234567',
      originatingUserId: 'guest-1',
    });
    expect(persisted.expiresAt).toBeGreaterThan(Date.now());
  });

  it('restores phone-change verification after a cold module reload', async () => {
    mocks.storage.set(
      '@sharmeats:pending-phone-verification:v1',
      JSON.stringify({
        type: 'phone_change',
        phone: '+201001234567',
        originatingUserId: 'guest-1',
        expiresAt: Date.now() + 60_000,
      }),
    );
    mocks.auth.getSession.mockResolvedValue({
      data: { session: { user: { id: 'guest-1', is_anonymous: true } } },
    });
    mocks.auth.verifyOtp.mockResolvedValue({
      data: { user: { id: 'guest-1', phone: '+201001234567' } },
      error: null,
    });

    const repo = await loadRepo();
    await expect(repo.verifyOtp('+201001234567', '123456')).resolves.toEqual({
      userId: 'guest-1',
      phone: '+201001234567',
    });
    expect(mocks.auth.verifyOtp).toHaveBeenCalledWith({
      phone: '+201001234567',
      token: '123456',
      type: 'phone_change',
    });
    expect(mocks.asyncStorage.removeItem).toHaveBeenCalledOnce();
  });

  it('fails closed when the pending flow is missing instead of defaulting to SMS', async () => {
    const repo = await loadRepo();

    await expect(repo.verifyOtp('+201001234567', '123456')).rejects.toThrow(
      /request a new code/i,
    );
    expect(mocks.auth.verifyOtp).not.toHaveBeenCalled();
  });

  it('rejects a restored phone-change flow if the anonymous user changed', async () => {
    mocks.storage.set(
      '@sharmeats:pending-phone-verification:v1',
      JSON.stringify({
        type: 'phone_change',
        phone: '+201001234567',
        originatingUserId: 'guest-1',
        expiresAt: Date.now() + 60_000,
      }),
    );
    mocks.auth.getSession.mockResolvedValue({
      data: { session: { user: { id: 'guest-2', is_anonymous: true } } },
    });

    const repo = await loadRepo();

    await expect(repo.verifyOtp('+201001234567', '123456')).rejects.toThrow(
      /session changed/i,
    );
    expect(mocks.auth.verifyOtp).not.toHaveBeenCalled();
  });

  it('persists and restores a normal SMS sign-in flow', async () => {
    mocks.auth.getSession.mockResolvedValue({ data: { session: null } });
    mocks.auth.signInWithOtp.mockResolvedValue({ error: null });
    mocks.auth.verifyOtp.mockResolvedValue({
      data: { user: { id: 'phone-user', phone: '+201009876543' } },
      error: null,
    });

    const repo = await loadRepo();
    await repo.sendOtp('+201009876543');
    const coldRepo = await loadRepo();
    await coldRepo.verifyOtp('+201009876543', '654321');

    expect(mocks.auth.verifyOtp).toHaveBeenCalledWith({
      phone: '+201009876543',
      token: '654321',
      type: 'sms',
    });
  });
});
