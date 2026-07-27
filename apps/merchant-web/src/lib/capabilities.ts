/**
 * merchant_staff.staff_role → what the merchant dashboard may offer (mig 136).
 *
 * The DATABASE is the authority. Migration 136 made staff_role load-bearing:
 * RLS policies gate menu/section/modifier writes and restaurants.is_open on
 * is_merchant_manager(), and a BEFORE UPDATE trigger on menu_items rejects
 * price/name/description/image/flags edits from a staff-tier account. These
 * predicates only decide what the UI *offers* — they can never grant anything
 * the DB refuses, and they must never offer something the DB will refuse.
 *
 * Keep this file in sync with migration 136's column comment on
 * merchant_staff.staff_role, which is the canonical statement of the tiers.
 *
 * Pure and dependency-free so it unit-tests without a Supabase client, matching
 * lib/onboarding.ts.
 */

/** The vocabulary merchant_staff.staff_role is constrained to (mig 136 CHECK). */
export const STAFF_ROLES = ['owner', 'manager', 'staff'] as const;
export type StaffRole = (typeof STAFF_ROLES)[number];

/**
 * Narrow a raw DB string to a known role. Anything unrecognised — '', a legacy
 * value, or a role added DB-side before this client ships — returns null, and
 * every capability below then DENIES.
 *
 * Fail closed, mirroring migration house rule 4 (`NULL <> 'admin'` evaluates to
 * NULL and fails OPEN, so role checks must never be written that way). Note the
 * DB's own backfill deliberately went the other way — it PROMOTED unrecognised
 * rows to 'owner' to avoid locking a live merchant out — but that was a one-off
 * migration decision about existing data. At runtime, an unknown role is a bug,
 * and a bug must not hand out privileges.
 */
export function parseStaffRole(raw: string | null | undefined): StaffRole | null {
  return STAFF_ROLES.includes(raw as StaffRole) ? (raw as StaffRole) : null;
}

/** Human label for the header chip. Unknown values show through verbatim. */
export function staffRoleLabel(raw: string | null | undefined): string {
  const role = parseStaffRole(raw);
  if (role === 'owner') return 'Owner';
  if (role === 'manager') return 'Manager';
  if (role === 'staff') return 'Staff';
  return raw?.trim() || 'Staff';
}

/**
 * The manager+ tier: 'owner' and 'manager' collapsed, exactly as migration 136
 * models it. Everything privileged keys off this ONE predicate so the client
 * cannot drift into offering a capability the DB splits differently.
 *
 * Covers, per mig 136:
 *   · menu_items  — price_egp, name, description, image, flags, section_id
 *                   (BEFORE UPDATE trigger), plus INSERT and DELETE (policy)
 *   · menu_sections, modifiers, modifier_options — all writes (policy)
 *   · restaurants — is_open AND the five payout_* columns, since
 *                   restaurants_merchant_update gates every client-writable
 *                   column on that table (grant list at mig 126:163)
 */
export function isManagerPlus(raw: string | null | undefined): boolean {
  const role = parseStaffRole(raw);
  return role === 'owner' || role === 'manager';
}

/**
 * Edit menu structure and PRICES. Manager+: a price change is money — it feeds
 * order_items at placement and therefore commission and settlement.
 */
export const canEditMenu = isManagerPlus;

/**
 * Pause/resume intake (restaurants.is_open). Manager+, NOT staff.
 *
 * This is deliberate and was confirmed with the owner: closing the storefront
 * costs every order until someone reopens it. 86-ing a single sold-out dish is
 * the line-cook-safe equivalent and stays open to everyone (below).
 */
export const canToggleOpen = isManagerPlus;

/**
 * "86" a dish — menu_items.is_available.
 *
 * Granted to EVERY merchant_staff row by the database: the trigger treats
 * is_available and sort_order as unprivileged precisely so a sold-out item can
 * be stopped by whoever is on the line. There is intentionally no predicate
 * here to call: gating this in the UI would remove the one action the tier
 * exists to protect. Documented as a constant so nobody re-adds a check.
 */
export const AVAILABILITY_IS_ALWAYS_ALLOWED = true;

/**
 * Friendly copy for a write the database refused.
 *
 * TWO refusal shapes exist and they look nothing alike — this is the subtlety
 * that makes error handling alone insufficient:
 *
 *   1. A TRIGGER raises. PostgREST surfaces SQLSTATE 23514 with a
 *      'MANAGER_REQUIRED: …' message. There IS an error object. This covers
 *      menu_items column writes AND restaurants.is_open — the latter uses a
 *      trigger specifically so the refusal is loud (mig 136 §6b).
 *   2. An RLS POLICY denial on INSERT raises 42501 (WITH CHECK is a
 *      constraint, not a filter).
 *   3. An RLS POLICY denial on UPDATE/DELETE does NOT raise. Postgres filters
 *      the row out of the statement's scope, so the write reports success
 *      having changed nothing (verified by execution, 2026-07-27). There is NO
 *      error object — `error` is null. Still live for the menu_sections and
 *      menu_items DELETE paths.
 *
 * Shape 3 is why callers must also check whether any row came back (see
 * `deniedByNoRows`), and why hiding the control is the primary defence rather
 * than a nicety: an error handler cannot catch an error that is never raised.
 */
export function permissionDeniedCopy(
  err: { code?: string; message?: string } | null | undefined,
): string | null {
  if (!err) return null;
  const message = err.message ?? '';
  // Match the SENTINEL, never the bare SQLSTATE. 23514 (check_violation) is
  // shared: migration 136's triggers raise it for MANAGER_REQUIRED, but so does
  // migration 132's price-bounds CHECK (price_egp between 1 and 10000). Testing
  // `code === '23514'` alone would tell an OWNER who typed 99999 EGP to "ask
  // the restaurant owner or a manager" — advice that is wrong, impossible to
  // act on, and hides the real reason. Verified: a code-only test misfires on
  // exactly that input.
  const denied =
    /MANAGER_REQUIRED/.test(message) ||
    err.code === '42501' ||
    /permission denied|row-level security/i.test(message);
  return denied ? PERMISSION_DENIED_COPY : null;
}

/**
 * The silent-denial case: a write that returned no error AND touched no row.
 * Callers must chain `.select('id')` on the statement for `rows` to be
 * meaningful — without it PostgREST returns nothing on success either, and this
 * would report a false denial.
 */
export function deniedByNoRows(
  err: unknown | null | undefined,
  rows: readonly unknown[] | null | undefined,
): boolean {
  return !err && Array.isArray(rows) && rows.length === 0;
}

/** Single source for the message, so both refusal shapes read identically. */
export const PERMISSION_DENIED_COPY =
  'Your account does not have permission for that. Ask the restaurant owner or a manager.';
