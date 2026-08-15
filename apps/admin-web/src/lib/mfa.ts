/**
 * TOTP multi-factor logic for the ops dashboard, kept pure and separate from the
 * React that calls it.
 *
 * WHY THIS EXISTS AT ALL: admin accounts reach dispatch, finance, commission
 * and KYC approval. One of their passwords was found published in a public
 * repository for eight weeks. TOTP is the cheapest thing that makes a leaked
 * admin password insufficient on its own.
 *
 * THE FAILURE MODE TO RESPECT: an MFA lockout is worse than a password lockout.
 * A forgotten password is recoverable by email; a lost authenticator app is not
 * recoverable by any self-service path, because the whole point is that only the
 * device can produce the code. The recovery route is deleting the factor row
 * server-side (Supabase dashboard → Authentication → Users → the account, or
 * `delete from auth.mfa_factors where user_id = ...` as the postgres role).
 * That is documented in docs/GO-LIVE.md rather than left to be discovered
 * during an incident.
 *
 * This file stays pure—no React or Supabase imports—so the complete assurance
 * truth table and route decision remain cheap unit tests.
 */

/** Supabase's assurance levels. aal1 = password only, aal2 = password + TOTP. */
export type AssuranceLevel = 'aal1' | 'aal2';

/**
 * What the sign-in flow should do next, derived from Supabase's two assurance
 * levels.
 *
 * The pair is the whole contract and it is easy to misread:
 *   currentLevel — what this session has ALREADY satisfied.
 *   nextLevel    — what it COULD satisfy, i.e. aal2 when a verified factor
 *                  exists on the account.
 *
 * So `aal1 + aal2` is the only state that means "a code is owed". A user with
 * no factor sits at `aal1 + aal1`; optional-MFA roles may continue, while an
 * admin must enroll. A user who passed a challenge is at `aal2 + aal2`.
 */
export type MfaGate =
  /** No verified factor on this account — nothing to prompt for. */
  | 'not_enrolled'
  /** This role must enroll a factor before it receives any authority. */
  | 'enrollment_required'
  /** A verified factor exists and this session has not satisfied it yet. */
  | 'code_required'
  /** Already at aal2 — let them through. */
  | 'satisfied'
  /** Supabase did not return a trustworthy answer. Never grant on uncertainty. */
  | 'indeterminate';

export function mfaGate(
  currentLevel: string | null | undefined,
  nextLevel: string | null | undefined,
  options: { enrollmentRequired?: boolean } = {},
): MfaGate {
  if (currentLevel === 'aal2' && nextLevel === 'aal2') return 'satisfied';
  if (currentLevel === 'aal2' && nextLevel === 'aal1') {
    return options.enrollmentRequired ? 'enrollment_required' : 'not_enrolled';
  }
  if (currentLevel === 'aal1' && nextLevel === 'aal2') return 'code_required';
  if (currentLevel === 'aal1' && nextLevel === 'aal1') {
    return options.enrollmentRequired ? 'enrollment_required' : 'not_enrolled';
  }
  return 'indeterminate';
}

/**
 * Route-level companion to the database authority gate.
 *
 * This does not grant access—the database does—but it prevents a password-only
 * admin session from ever painting sensitive dashboard UI. An unenrolled admin
 * gets exactly one usable destination, `/security`; a session that owes a code
 * or whose assurance level is unknown must start the login challenge again.
 */
export function mfaRouteRedirect(
  pathname: string,
  role: string | null | undefined,
  gate: MfaGate,
): '/login' | '/security' | null {
  if (gate === 'code_required' || gate === 'indeterminate') return '/login';
  if (gate === 'enrollment_required' || (role === 'admin' && gate === 'not_enrolled')) {
    return pathname === '/security' || pathname.startsWith('/security/') ? null : '/security';
  }
  return null;
}

/**
 * Authenticator apps display codes as "123 456", and both phone keyboards and
 * paste tend to bring the space along. Strip everything that is not a digit
 * rather than rejecting input a human would consider correct.
 */
export function normalizeTotpCode(raw: string): string {
  return (raw ?? '').replace(/\D/g, '').slice(0, 6);
}

/** TOTP codes are exactly six digits. */
export function isCompleteTotpCode(raw: string): boolean {
  return normalizeTotpCode(raw).length === 6;
}

/**
 * Turn Supabase's MFA errors into something an operator can act on.
 *
 * The raw strings are unhelpful at the two moments that matter most — a
 * mistyped code and an expired challenge read almost identically, but only one
 * of them means "try again with a fresh code".
 */
export function describeMfaError(message: string | null | undefined): string {
  const m = (message ?? '').toLowerCase();
  if (!m) return 'Could not verify that code. Try again.';
  if (m.includes('invalid') || m.includes('incorrect')) {
    return 'That code was not accepted. Codes change every 30 seconds — wait for the next one and retype it.';
  }
  if (m.includes('expired')) {
    return 'That code expired before it was submitted. Enter the current one.';
  }
  if (m.includes('rate') || m.includes('too many')) {
    return 'Too many attempts. Wait a minute before trying again.';
  }
  return message ?? 'Could not verify that code. Try again.';
}

/**
 * A factor as the enrolment screen needs it, narrowed from Supabase's shape.
 * `status` matters: enroll() creates an UNVERIFIED factor immediately, and it
 * lingers if the operator abandons the flow. Those stale rows are what make a
 * second enrol attempt fail, so the UI has to be able to see and clear them.
 */
export interface TotpFactorView {
  id: string;
  friendlyName: string;
  verified: boolean;
}

export function toFactorViews(
  factors: readonly { id: string; friendly_name?: string | null; status?: string | null }[] | null | undefined,
): TotpFactorView[] {
  return (factors ?? []).map((f) => ({
    id: f.id,
    friendlyName: f.friendly_name?.trim() || 'Authenticator app',
    verified: f.status === 'verified',
  }));
}

/**
 * Stale unverified factors block a fresh enrolment with "factor already
 * exists". Enrolling again is the common case — someone starts the flow, loses
 * the tab, and comes back — so the screen clears these first rather than
 * showing an error the operator cannot interpret.
 */
export function staleUnverifiedFactorIds(factors: readonly TotpFactorView[]): string[] {
  return factors.filter((f) => !f.verified).map((f) => f.id);
}

/** True once at least one factor is verified, i.e. the account is protected. */
export function hasVerifiedFactor(factors: readonly TotpFactorView[]): boolean {
  return factors.some((f) => f.verified);
}
