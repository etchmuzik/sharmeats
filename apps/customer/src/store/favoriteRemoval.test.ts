/**
 * The offline-removal sequence, end to end through the STORE.
 *
 * favoritesMerge.test.ts covers the pure merge rule. This covers the thing that
 * actually bit: the interaction between toggleFavorite (which writes the
 * tombstone) and mergeFavoritesFromServer (which consumes it). A correct merge
 * function wired to a store that never records a tombstone would still lose the
 * removal, so the unit test alone does not prove the fix.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn(async () => null),
    setItem: vi.fn(async () => undefined),
    removeItem: vi.fn(async () => undefined),
  },
}));

// session.ts -> deviceLocale.ts -> 'react-native', which vitest cannot parse.
// Only the locale default is needed here, so stub the module rather than pull
// the whole RN runtime into a store test.
vi.mock('../lib/deviceLocale', () => ({ detectDeviceLanguage: () => 'en' }));

import { useSession } from './session';

const RESTAURANT = 'rest-synced';

beforeEach(() => {
  useSession.setState({
    favoriteIds: [RESTAURANT],
    syncedFavoriteIds: [RESTAURANT],
    pendingFavoriteRemovals: [],
  });
});

describe('offline removal of a synced favourite', () => {
  it('records a tombstone when a SYNCED favourite is removed', () => {
    useSession.getState().toggleFavorite(RESTAURANT);
    expect(useSession.getState().favoriteIds).not.toContain(RESTAURANT);
    expect(useSession.getState().pendingFavoriteRemovals).toEqual([RESTAURANT]);
  });

  it('does NOT resurrect it when the server still reports it (the actual bug)', () => {
    // Offline: local removal succeeded, DELETE did not.
    useSession.getState().toggleFavorite(RESTAURANT);
    // Next launch — the server still has it.
    const { needsRemoval } = useSession.getState().mergeFavoritesFromServer([RESTAURANT]);

    expect(useSession.getState().favoriteIds).not.toContain(RESTAURANT);
    expect(needsRemoval).toEqual([RESTAURANT]);
    // Must not be re-marked as synced, or the next merge re-arms the bug.
    expect(useSession.getState().syncedFavoriteIds).not.toContain(RESTAURANT);
  });

  it('survives repeated launches while still offline', () => {
    useSession.getState().toggleFavorite(RESTAURANT);
    for (let i = 0; i < 3; i++) {
      useSession.getState().mergeFavoritesFromServer([RESTAURANT]);
      expect(useSession.getState().favoriteIds).not.toContain(RESTAURANT);
    }
    expect(useSession.getState().pendingFavoriteRemovals).toEqual([RESTAURANT]);
  });

  it('clears the tombstone once the server confirms the delete', () => {
    useSession.getState().toggleFavorite(RESTAURANT);
    // Delete landed: the server no longer lists it.
    const { needsRemoval } = useSession.getState().mergeFavoritesFromServer([]);
    expect(needsRemoval).toEqual([]);
    expect(useSession.getState().pendingFavoriteRemovals).toEqual([]);
  });

  it('lets a re-favourite beat a pending tombstone', () => {
    useSession.getState().toggleFavorite(RESTAURANT); // remove
    useSession.getState().toggleFavorite(RESTAURANT); // changed their mind
    expect(useSession.getState().favoriteIds).toContain(RESTAURANT);
    expect(useSession.getState().pendingFavoriteRemovals).toEqual([]);

    useSession.getState().mergeFavoritesFromServer([RESTAURANT]);
    expect(useSession.getState().favoriteIds).toContain(RESTAURANT);
  });

  it('does not tombstone an UNSYNCED favourite (nothing to delete)', () => {
    useSession.setState({
      favoriteIds: ['guest-pick'],
      syncedFavoriteIds: [],
      pendingFavoriteRemovals: [],
    });
    useSession.getState().toggleFavorite('guest-pick');
    expect(useSession.getState().pendingFavoriteRemovals).toEqual([]);
  });

  it('still rescues guest picks while a removal is pending', () => {
    useSession.setState({
      favoriteIds: [RESTAURANT, 'guest-pick'],
      syncedFavoriteIds: [RESTAURANT],
      pendingFavoriteRemovals: [],
    });
    useSession.getState().toggleFavorite(RESTAURANT);
    const { needsUpload, needsRemoval } = useSession
      .getState()
      .mergeFavoritesFromServer([RESTAURANT]);

    expect(needsUpload).toEqual(['guest-pick']);
    expect(needsRemoval).toEqual([RESTAURANT]);
    expect(useSession.getState().favoriteIds).toEqual(['guest-pick']);
  });

  it('clears tombstones on sign-out (private state must not leak to the next user)', () => {
    useSession.getState().toggleFavorite(RESTAURANT);
    expect(useSession.getState().pendingFavoriteRemovals).toEqual([RESTAURANT]);
    useSession.getState().signOut();
    expect(useSession.getState().pendingFavoriteRemovals).toEqual([]);
  });
});
