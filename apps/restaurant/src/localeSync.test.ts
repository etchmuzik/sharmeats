/**
 * [203 P2-03] Merchant staff language must reach public.users.locale, because
 * that column — not AsyncStorage — is what expo-push localizes every push from.
 * Arabic restaurant copy shipped 2026-07-30, but nothing ever wrote the column,
 * so Arabic-selecting staff still received order_placed_merchant, low_rating
 * and settlement_* pushes in English.
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

describe('syncLocaleToProfile (restaurant)', () => {
  beforeEach(() => {
    getUser.mockReset();
    eq.mockReset();
    update.mockClear();
    from.mockClear();
    configured = true;
  });

  it('writes the chosen locale to the signed-in staffer row', async () => {
    getUser.mockResolvedValue({ data: { user: { id: 'staff-1' } } });
    eq.mockResolvedValue({ error: null });

    await expect(syncLocaleToProfile('ar')).resolves.toBe(true);
    expect(from).toHaveBeenCalledWith('users');
    expect(update).toHaveBeenCalledWith({ locale: 'ar' });
    expect(eq).toHaveBeenCalledWith('id', 'staff-1');
  });

  it('is a no-op when nobody is signed in', async () => {
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
    getUser.mockResolvedValue({ data: { user: { id: 'staff-1' } } });
    eq.mockResolvedValue({ error: { message: 'permission denied' } });

    await expect(syncLocaleToProfile('ar')).resolves.toBe(false);
  });

  it('never throws when the client blows up mid-service', async () => {
    getUser.mockRejectedValue(new Error('network down'));

    // A language tap on a kitchen tablet must never surface an error.
    await expect(syncLocaleToProfile('ar')).resolves.toBe(false);
  });
});
