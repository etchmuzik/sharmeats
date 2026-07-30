import { describe, expect, it } from 'vitest';
import {
  NAV_ITEMS,
  activeNavHref,
  isChromelessRoute,
  visibleNavItems,
} from './navItems';

/**
 * navItems.ts was written pure specifically so these could exist once a runner
 * did (PR #98 shipped it with browser probes instead). The behaviours below
 * were all verified in Chromium then; this makes them regression-proof.
 */
describe('visibleNavItems — fails closed', () => {
  it('returns nothing for an unrecognised role', () => {
    expect(visibleNavItems('merchant_staff')).toEqual([]);
    expect(visibleNavItems('superadmin')).toEqual([]);
  });

  it('returns nothing for a missing role — null, undefined, empty', () => {
    // role comes from a users.role column read in the browser; it can genuinely
    // be absent. Painting a full admin nav for a role-less session is the bug
    // this function exists to prevent.
    expect(visibleNavItems(null)).toEqual([]);
    expect(visibleNavItems(undefined)).toEqual([]);
    expect(visibleNavItems('')).toEqual([]);
  });

  it('gives a dispatcher only dispatcher destinations', () => {
    const hrefs = visibleNavItems('dispatcher').map((i) => i.href);
    expect(hrefs).toContain('/');
    expect(hrefs).toContain('/security');
    expect(hrefs).not.toContain('/finance');
    expect(hrefs).not.toContain('/kyc');
  });

  it('gives an admin every destination', () => {
    expect(visibleNavItems('admin')).toHaveLength(NAV_ITEMS.length);
  });

  it('lets both roles reach /security — securing your own account is never withheld', () => {
    for (const role of ['admin', 'dispatcher'] as const) {
      expect(visibleNavItems(role).map((i) => i.href)).toContain('/security');
    }
  });
});

describe('activeNavHref — longest match wins', () => {
  it('does not let /finance claim /driver-finance', () => {
    expect(activeNavHref('/driver-finance')).toBe('/driver-finance');
    expect(activeNavHref('/finance')).toBe('/finance');
  });

  it('matches subpaths to their section', () => {
    expect(activeNavHref('/kyc/abc123')).toBe('/kyc');
  });

  it('only matches / exactly, never as a prefix', () => {
    expect(activeNavHref('/')).toBe('/');
    expect(activeNavHref('/support')).toBe('/support');
  });

  it('returns null for a route with no nav entry', () => {
    expect(activeNavHref('/reset-password')).toBeNull();
  });
});

describe('isChromelessRoute', () => {
  it('hides the shell on auth routes', () => {
    expect(isChromelessRoute('/login')).toBe(true);
    expect(isChromelessRoute('/reset-password')).toBe(true);
  });

  it('shows the shell everywhere else', () => {
    expect(isChromelessRoute('/')).toBe(false);
    expect(isChromelessRoute('/security')).toBe(false);
  });
});
