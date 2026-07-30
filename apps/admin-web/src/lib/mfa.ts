/**
 * TOTP multi-factor logic for the ops dashboard, kept pure and separate from the
 * React that calls it.
 *
 * WHY THIS EXISTS AT ALL: production has exactly one admin account, and that
 * account reaches dispatch, finance, commission and KYC approval. A password is
 * the only thing in front of all of it — and on 2026-07-30 that password was
 * found published in a public repository for eight weeks. TOTP is the cheapest
 * thing that makes a leaked admin password insufficient on its own.
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
 * `admin-web` has no test runner yet (see PR #98), so this file is written as
 * plain functions with no React or Supabase imports — it can be unit-tested
 * unchanged the day one is added, exactly like navItems.ts.
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
 * no factor sits at `aal1 + aal1` forever and must not be prompted, and a user
 * who has just passed a challenge is at `aal2 + aal2`.
 */
export type MfaGate =
  /** No verified factor on this account — nothing to prompt for. */
  | 'not_enrolled'
  /** A verified factor exists and this session has not satisfied it yet. */
  | 'code_required'
  /** Already at aal2 — let them through. */
  | 'satisfied';

export function mfaGate(
  currentLevel: string | null | undefined,
  nextLevel: string | null | undefined,
): MfaGate {
  if (currentLevel === 'aal2') return 'satisfied';
  if (nextLevel === 'aal2') return 'code_required';
  // Includes the null/undefined case. Fail OPEN deliberately: getAuthenticator-
  // AssuranceLevel() returning nothing means we could not determine the state,
  // and blocking sign-in on an indeterminate answer would lock the only admin
  // out of production over a transient. The database is the real authority on
  // what an aal1 session may do; this gate is a prompt, not a permission.
  return 'not_enrolled';
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
