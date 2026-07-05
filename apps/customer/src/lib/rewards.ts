/**
 * Visual-only tier-bar floor (Goal Gradient Effect).
 *
 * The rewards tier bar is backed by a real points ledger; a brand-new user's
 * true fill is 0%. To avoid a demoralizing empty bar we render a small non-zero
 * "starter" width — but ONLY for the visual bar. The accessibility value and all
 * numeric labels must keep showing the TRUE percentage (see rewards.tsx). No
 * points are credited; this is pure presentation.
 */
export const STARTER_FILL_PCT = 8;

/** Floor the visual fill to the starter value, clamped to [0, 100]. */
export function starterFloorPct(truePct: number): number {
  return Math.min(100, Math.max(truePct, STARTER_FILL_PCT));
}
