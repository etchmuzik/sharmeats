/**
 * [203 P2-03] The driver's language must reach public.users.locale, because
 * that column — not AsyncStorage — is what expo-push localizes every push from.
 * Arabic driver copy shipped 2026-07-30, but nothing ever wrote the column, so
 * an Arabic-first driver still received new_offer, order_ready_pickup,
 * order_cancelled_driver, settlement and KYC pushes in English.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';

const getUser = vi.fn();
const eq = vi.fn();
const update = vi.fn(() => ({ eq }));
const from = vi.fn(() => ({ update }));
let configured = true;

vi.mock('./supabase', () => ({
  getSupabase: () => ({ auth: { getUser }, from }),
  isSupabaseConfigured: () => configured,
}));

import { syncLocaleToProfile } from './localeSync';

describe('syncLocaleToProfile (driver)', () => {
  beforeEach(() => {
    getUser.mockReset();
    eq.mockReset();
    update.mockClear();
    from.mockClear();
    configured = true;
  });

  it('writes the chosen locale to the signed-in driver row', async () => {
    getUser.mockResolvedValue({ data: { user: { id: 'driver-1' } } });
    eq.mockResolvedValue({ error: null });

    await expect(syncLocaleToProfile('ar')).resolves.toBe(true);
    expect(from).toHaveBeenCalledWith('users');
    expect(update).toHaveBeenCalledWith({ locale: 'ar' });
    // Scoped to the caller's own row — RLS enforces this too, but the client
    // must not rely on that alone.
    expect(eq).toHaveBeenCalledWith('id', 'driver-1');
  });

  it('passes each supported locale through unchanged', async () => {
    getUser.mockResolvedValue({ data: { user: { id: 'driver-1' } } });
    eq.mockResolvedValue({ error: null });

    for (const locale of ['en', 'ar'] as const) {
      await syncLocaleToProfile(locale);
      expect(update).toHaveBeenLastCalledWith({ locale });
    }
  });

  it('is a no-op when no driver is signed in', async () => {
    getUser.mockResolvedValue({ data: { user: null } });

    await expect(syncLocaleToProfile('ar')).resolves.toBe(false);
    expect(update).not.toHaveBeenCalled();
  });

  it('is a no-op when Supabase is not configured', async () => {
    configured = false;

    await expect(syncLocaleToProfile('ar')).resolves.toBe(false);
    expect(getUser).not.toHaveBeenCalled();
  });

  it('reports failure without throwing when the write is rejected', async () => {
    getUser.mockResolvedValue({ data: { user: { id: 'driver-1' } } });
    eq.mockResolvedValue({ error: { message: 'permission denied' } });

    await expect(syncLocaleToProfile('ar')).resolves.toBe(false);
  });

  it('never throws when the client itself blows up mid-shift', async () => {
    getUser.mockRejectedValue(new Error('network down'));

    // A language switch must never surface an error or block the UI: the next
    // switch, or the next app start, re-syncs.
    await expect(syncLocaleToProfile('ar')).resolves.toBe(false);
  });
});
