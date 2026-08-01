/**
 * [202 F-03] The customer's language must reach public.users.locale, because
 * that column — not the app store — is what expo-push localizes every push
 * from. Before this, the column sat at its 'ar' signup default for every
 * account and the whole 5-locale push copy layer was unreachable.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';

const update = vi.fn();

vi.mock('../data', () => ({
  db: {
    get user() {
      return { update };
    },
  },
}));

import { syncLocaleToProfile } from './localeSync';

describe('syncLocaleToProfile', () => {
  beforeEach(() => {
    update.mockReset();
  });

  it('writes the chosen locale to the profile', async () => {
    update.mockResolvedValue({});
    await expect(syncLocaleToProfile('ru')).resolves.toBe(true);
    expect(update).toHaveBeenCalledWith({ locale: 'ru' });
  });

  it('passes each supported locale through unchanged', async () => {
    update.mockResolvedValue({});
    for (const locale of ['en', 'ar', 'ru', 'it', 'de'] as const) {
      await syncLocaleToProfile(locale);
      expect(update).toHaveBeenLastCalledWith({ locale });
    }
  });

  it('never throws when the user is a guest or the write fails', async () => {
    // The repository throws 'Not authenticated' for a guest. A language tap must
    // not surface an error or block on the network, so this resolves false.
    update.mockRejectedValue(new Error('Not authenticated'));
    await expect(syncLocaleToProfile('de')).resolves.toBe(false);
  });

  it('reports failure rather than silently claiming success', async () => {
    // Distinguishing the two matters: a caller that wanted to retry (or a test
    // asserting the write landed) must not be told a rejected write succeeded.
    update.mockRejectedValue(new Error('network'));
    expect(await syncLocaleToProfile('it')).toBe(false);
    update.mockResolvedValue({});
    expect(await syncLocaleToProfile('it')).toBe(true);
  });
});
