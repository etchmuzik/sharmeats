/**
 * The ops dashboard's destinations, in one list.
 *
 * Before this existed there was no navigation at all: eleven screens reachable
 * only by typing a URL. What filled the gap was ad-hoc cross-links hand-wired
 * between whichever pages happened to feel related — /cash linked to
 * /driver-finance and /finance, /finance linked back to /driver-finance — so
 * whether you could reach a screen depended on which screen you were standing
 * on. /support, /scorecards, /campaigns and /founding-rates were linked from
 * nowhere.
 *
 * Roles are declared per destination and mirror the gate each page already
 * enforces for itself. This list does NOT grant anything: every page re-checks
 * the role on mount, and RLS is the real authority. It exists so the nav does
 * not advertise a door that will slam in the user's face — a dispatcher shown
 * "Finance" only learns it is off-limits after clicking.
 */
export type OpsRole = 'admin' | 'dispatcher';

export interface NavItem {
  href: string;
  label: string;
  /** Roles that may open this page, matching the page's own on-mount gate. */
  roles: readonly OpsRole[];
  /** Grouping heading in the sidebar. */
  group: 'Operations' | 'Catalogue' | 'Money';
}

/**
 * Labels match what each page calls itself in its own header, so the nav and
 * the destination agree. Order within a group is roughly daily-use frequency.
 */
export const NAV_ITEMS: readonly NavItem[] = [
  { href: '/', label: 'Dispatch', roles: ['admin', 'dispatcher'], group: 'Operations' },
  { href: '/support', label: 'Support', roles: ['admin'], group: 'Operations' },
  { href: '/kyc', label: 'KYC', roles: ['admin'], group: 'Operations' },
  { href: '/onboarding', label: 'Onboarding', roles: ['admin'], group: 'Operations' },
  { href: '/menu', label: 'Menu', roles: ['admin'], group: 'Catalogue' },
  { href: '/campaigns', label: 'Campaigns', roles: ['admin'], group: 'Catalogue' },
  { href: '/scorecards', label: 'Scorecards', roles: ['admin'], group: 'Catalogue' },
  { href: '/finance', label: 'Finance', roles: ['admin'], group: 'Money' },
  { href: '/driver-finance', label: 'Driver payouts', roles: ['admin'], group: 'Money' },
  { href: '/cash', label: 'Cash', roles: ['admin'], group: 'Money' },
  { href: '/founding-rates', label: 'Founding rates', roles: ['admin'], group: 'Money' },
  { href: '/fx', label: 'FX rates', roles: ['admin'], group: 'Money' },
  { href: '/audit', label: 'Money out', roles: ['admin'], group: 'Money' },
  // Both roles: securing your own account is never something to withhold, and
  // the page only ever shows the signed-in user their own factors.
  { href: '/security', label: 'Security', roles: ['admin', 'dispatcher'], group: 'Operations' },
];

/** Group order in the sidebar. Derived from NAV_ITEMS would lose the intended order. */
export const NAV_GROUPS = ['Operations', 'Catalogue', 'Money'] as const;

/**
 * Destinations this role may actually open.
 *
 * Fails CLOSED on an unrecognised role. `role` arrives from a `users.role`
 * column read in the browser and is typed `string | undefined` at every call
 * site, so it can genuinely be null, a role added later, or absent because the
 * lookup failed. Returning everything in that case would paint a full admin nav
 * for someone who cannot open any of it; returning nothing renders no sidebar,
 * which is what an unauthenticated visitor already sees.
 */
export function visibleNavItems(role: string | null | undefined): NavItem[] {
  if (role !== 'admin' && role !== 'dispatcher') return [];
  return NAV_ITEMS.filter((item) => item.roles.includes(role));
}

/**
 * Which nav entry a pathname belongs to.
 *
 * Longest match wins, so `/finance` does not claim `/driver-finance`, and `/`
 * only ever matches itself rather than prefixing every route in the app.
 */
export function activeNavHref(pathname: string): string | null {
  let best: string | null = null;
  for (const { href } of NAV_ITEMS) {
    const matches = href === '/' ? pathname === '/' : pathname === href || pathname.startsWith(`${href}/`);
    if (matches && (best === null || href.length > best.length)) best = href;
  }
  return best;
}

/**
 * Routes that must never show the shell: nobody is signed in yet, and a
 * sidebar full of destinations that all bounce to /login is worse than none.
 */
export const CHROMELESS_ROUTES = ['/login', '/reset-password'] as const;

export function isChromelessRoute(pathname: string): boolean {
  return CHROMELESS_ROUTES.some((r) => pathname === r || pathname.startsWith(`${r}/`));
}
