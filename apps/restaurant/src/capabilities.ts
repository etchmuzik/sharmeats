/**
 * merchant_staff.staff_role → what the kitchen tablet may offer (mig 136).
 *
 * Mirrors apps/merchant-web/src/lib/capabilities.ts — same contract, same
 * tiers. The two apps cannot share one module: only `packages/*` are npm
 * workspaces and neither app depends on the other. If you change a tier here,
 * change it there, and change migration 136's column comment on
 * merchant_staff.staff_role, which is the canonical statement of the tiers.
 *
 * The DATABASE is the authority. Migration 136 gates restaurants.is_open on
 * is_merchant_manager() and rejects staff-tier price/structure edits via a
 * trigger on menu_items. These predicates only decide what the UI *offers*.
 */

/** The vocabulary merchant_staff.staff_role is constrained to (mig 136 CHECK). */
export const STAFF_ROLES = ['owner', 'manager', 'staff'] as const;
export type StaffRole = (typeof STAFF_ROLES)[number];

/**
 * Narrow a raw DB string to a known role. Unrecognised → null → DENY.
 * Fail closed, mirroring migration house rule 4.
 */
export function parseStaffRole(raw: string | null | undefined): StaffRole | null {
  return STAFF_ROLES.includes(raw as StaffRole) ? (raw as StaffRole) : null;
}

/** Human label for the header. Unknown values show through verbatim. */
export function staffRoleLabel(raw: string | null | undefined): string {
  const role = parseStaffRole(raw);
  if (role === 'owner') return 'Owner';
  if (role === 'manager') return 'Manager';
  if (role === 'staff') return 'Staff';
  return raw?.trim() || 'Staff';
}

/** The manager+ tier: 'owner' and 'manager' collapsed, exactly as mig 136 models it. */
export function isManagerPlus(raw: string | null | undefined): boolean {
  const role = parseStaffRole(raw);
  return role === 'owner' || role === 'manager';
}

/**
 * May this account pause/resume intake for EVERY brand it is about to touch?
 *
 * The cloud-kitchen case makes this different from the web dashboard: one
 * account can staff several brands (merchant_staff PK is
 * (profile_id, restaurant_id)), and the roles need not match across them. The
 * home screen's toggle writes ALL brands in one action, so it must require
 * manager+ on all of them — otherwise Promise.all partially succeeds, some
 * storefronts flip and others silently do not, and the tablet shows a state
 * the server disagrees with.
 *
 * Empty list → false. An account with no brands has nothing to toggle, and
 * fail-closed is the right default.
 */
export function canToggleOpenAll(roles: readonly (string | null | undefined)[]): boolean {
  return roles.length > 0 && roles.every(isManagerPlus);
}

/**
 * May this account set busy mode (mig 186's prep bump) on EVERY brand it staffs?
 *
 * set_busy_mode gates on is_merchant_manager() exactly as restaurants.is_open
 * does, and the header applies busy mode to all brands in one action for the
 * same reason the open/closed toggle does — one kitchen, one pass. The rule is
 * therefore identical, and it deliberately SHARES the implementation rather than
 * being restated: two copies of a permission rule drift, and the direction they
 * drift in is always "offers a control the server will refuse".
 */
export const canSetBusyAll = canToggleOpenAll;

/**
 * "86" a dish — menu_items.is_available. Granted to EVERY merchant_staff row
 * by migration 136 precisely so a sold-out item can be stopped by whoever is
 * on the line. There is deliberately no predicate to call; documented as a
 * constant so nobody re-adds a gate here.
 */
export const AVAILABILITY_IS_ALWAYS_ALLOWED = true;

/** Single source for the message, so every refusal reads identically. */
export const PERMISSION_DENIED_COPY =
  'Your account does not have permission for that. Ask the restaurant owner or a manager.';

/**
 * Friendly copy for a write the database refused, or null when the failure is
 * something else (which must keep its own message — errors are never swallowed).
 *
 * src/orders.ts and src/menu.ts throw the PostgrestError, so both `.code` and
 * `.message` are read off the thrown value. Three refusal shapes exist:
 *   · the menu_items trigger raises 23514 with a 'MANAGER_REQUIRED: …' message;
 *   · the restaurants trigger (mig 136 §6b) does the same for is_open —
 *     deliberately, because an RLS denial there would be SILENT and a kitchen
 *     that believes it is closed while orders keep arriving is a real incident;
 *   · a table/column grant refusal raises 42501.
 *
 * The fourth shape is the one that cannot be caught here: an RLS POLICY denial
 * on UPDATE/DELETE raises NOTHING — Postgres filters the row out and reports
 * success with zero rows affected. That still applies to the menu_sections /
 * menu_items DELETE paths, and it is why hiding a control from the staff tier
 * is the primary defence rather than a nicety.
 */
export function permissionDeniedMessage(e: unknown): string | null {
  const code = (e as { code?: string } | null)?.code;
  const message =
    e instanceof Error ? e.message : ((e as { message?: string } | null)?.message ?? '');
  // Match the SENTINEL, never the bare SQLSTATE. 23514 (check_violation) is
  // shared: migration 136's triggers raise it for MANAGER_REQUIRED, but so does
  // migration 132's price-bounds CHECK. Testing `code === '23514'` alone would
  // tell an OWNER who typed 99999 EGP to "ask the restaurant owner or a
  // manager" — advice that is both wrong and impossible to act on, and it would
  // bury the real reason (the price is out of range). Verified: that misfire is
  // exactly what a code-only test produces.
  const denied =
    /MANAGER_REQUIRED/.test(message) ||
    code === '42501' ||
    /permission denied|row-level security/i.test(message);
  return denied ? PERMISSION_DENIED_COPY : null;
}
