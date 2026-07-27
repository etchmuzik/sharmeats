import { describe, it, expect } from 'vitest';
import { mergeFavorites } from './favoritesMerge';

describe('mergeFavorites — guest picks survive sign-in', () => {
  it('rescues guest favourites the server has never seen', () => {
    // The headline case: saved 2 places as a guest, then signed in with a phone
    // that already had an account. Before this fix both were silently lost.
    const r = mergeFavorites(['guest-a', 'guest-b'], ['acct-x'], []);
    expect(r.merged).toEqual(['guest-a', 'guest-b', 'acct-x']);
    expect(r.needsUpload).toEqual(['guest-a', 'guest-b']);
  });

  it('keeps the server list when local is empty (fresh install, returning user)', () => {
    const r = mergeFavorites([], ['acct-x', 'acct-y'], []);
    expect(r.merged).toEqual(['acct-x', 'acct-y']);
    expect(r.needsUpload).toEqual([]);
  });

  it('re-uploads a favourite whose mirror write failed offline', () => {
    // Toggled on while offline: present locally, never confirmed synced.
    const r = mergeFavorites(['offline-pick'], [], []);
    expect(r.needsUpload).toEqual(['offline-pick']);
    expect(r.merged).toEqual(['offline-pick']);
  });
});

describe('mergeFavorites — deliberate removals stay removed', () => {
  it('drops a favourite that was synced and is now absent from the server', () => {
    // Removed on another device. A blind union would resurrect it forever —
    // this is the reason the merge tracks `synced` at all.
    const r = mergeFavorites(['gone', 'kept'], ['kept'], ['gone', 'kept']);
    expect(r.merged).toEqual(['kept']);
    expect(r.needsUpload).toEqual([]);
  });

  it('does not re-upload a removal even when other picks need uploading', () => {
    const r = mergeFavorites(['removed-elsewhere', 'new-guest'], ['on-server'], ['removed-elsewhere']);
    expect(r.needsUpload).toEqual(['new-guest']);
    expect(r.merged).toEqual(['new-guest', 'on-server']);
  });
});

describe('mergeFavorites — offline removal of a SYNCED favourite', () => {
  // The gap `synced` alone cannot close. Un-favourite a restaurant the server
  // already has, while offline:
  //   - it leaves favoriteIds (local list) immediately;
  //   - the DELETE fails, so the server still has it;
  //   - it is still in `synced`, because it genuinely WAS synced.
  // The next launch merges [...needsUpload, ...server] and puts it straight
  // back. The customer's deliberate removal is silently reversed, and doing it
  // again while still offline reverses it again.

  it('does not resurrect a favourite with a pending removal', () => {
    const r = mergeFavorites(['kept'], ['kept', 'removed-offline'], ['kept', 'removed-offline'], [
      'removed-offline',
    ]);
    expect(r.merged).toEqual(['kept']);
    expect(r.merged).not.toContain('removed-offline');
  });

  it('still reports the removal as pending so it can be retried on reconnect', () => {
    const r = mergeFavorites([], ['removed-offline'], ['removed-offline'], ['removed-offline']);
    expect(r.needsRemoval).toEqual(['removed-offline']);
  });

  it('clears the tombstone once the server confirms the id is gone', () => {
    // Server no longer has it: the removal landed. Keeping the tombstone
    // forever would block ever re-favouriting the place.
    const r = mergeFavorites([], ['other'], ['other'], ['already-deleted']);
    expect(r.needsRemoval).toEqual([]);
  });

  it('lets a re-favourite win over a stale tombstone', () => {
    // Removed offline, then changed their mind and tapped it again before the
    // queue drained. The later intent is the real one.
    const r = mergeFavorites(['changed-mind'], ['changed-mind'], ['changed-mind'], []);
    expect(r.merged).toEqual(['changed-mind']);
    expect(r.needsRemoval).toEqual([]);
  });

  it('is unchanged when there are no pending removals', () => {
    const r = mergeFavorites(['guest-a'], ['acct-x'], [], []);
    expect(r.merged).toEqual(['guest-a', 'acct-x']);
    expect(r.needsUpload).toEqual(['guest-a']);
    expect(r.needsRemoval).toEqual([]);
  });
});

describe('mergeFavorites — bookkeeping', () => {
  it('reports the server list as the new synced set', () => {
    const r = mergeFavorites(['local'], ['s1', 's2'], []);
    expect(r.synced).toEqual(['s1', 's2']);
  });

  it('never duplicates an id present both locally and on the server', () => {
    const r = mergeFavorites(['both'], ['both'], []);
    expect(r.merged).toEqual(['both']);
    expect(r.needsUpload).toEqual([]);
  });

  it('de-dupes a corrupted local list', () => {
    const r = mergeFavorites(['dup', 'dup'], [], []);
    expect(r.merged).toEqual(['dup']);
  });

  it('puts rescued picks before server ones so recent intent stays visible', () => {
    const r = mergeFavorites(['fresh'], ['old1', 'old2'], []);
    expect(r.merged[0]).toBe('fresh');
  });

  it('is a pure function — it does not mutate its inputs', () => {
    const local = ['a'];
    const server = ['b'];
    const synced: string[] = [];
    mergeFavorites(local, server, synced);
    expect(local).toEqual(['a']);
    expect(server).toEqual(['b']);
    expect(synced).toEqual([]);
  });
});
