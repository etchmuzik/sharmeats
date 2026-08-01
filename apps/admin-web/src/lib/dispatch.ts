/**
 * Driver reachability, kept in step with the database.
 *
 * Migration 201 changed `nearest_drivers` to require a ping within
 * `platform_settings.dispatch_max_ping_age_seconds` (default 300) on top of
 * online/verified/active. The reason, from the 2026-07-31 incident: `status` is
 * INTENT — the driver app sets it when going on shift and it survives a
 * force-quit, a dead battery or a crash — while `last_ping_at` is EVIDENCE that
 * the app was actually running that recently. Two seed drivers sat at
 * status='online' with a last ping from 4 June, and orders re-dispatched to
 * their silent phones 176 and 3,429 times.
 *
 * That fixed automatic dispatch and left the manual path untouched: the board
 * still listed those drivers as online and still let a dispatcher assign to
 * them, reproducing the same dead-end one click at a time. These helpers exist
 * so the UI applies the identical rule the RPC does.
 */

/**
 * Fallback when `platform_settings.dispatch_max_ping_age_seconds` cannot be
 * read. Must match the default in migration 201 — if you change one, change
 * both, or the board and dispatch will disagree again.
 */
export const DEFAULT_MAX_PING_AGE_SECONDS = 300;

/**
 * True when a driver's phone has not reported recently enough to be trusted.
 *
 * Fails CLOSED on missing or unparseable timestamps, matching the migration's
 * `coalesce(d.last_ping_at, '-infinity')` and house rule 4: absence of evidence
 * must not read as evidence of presence. A driver who has never pinged is
 * stale, not fresh.
 */
export function isPingStale(
  lastPingAt: string | null | undefined,
  nowMs: number,
  maxAgeSeconds: number = DEFAULT_MAX_PING_AGE_SECONDS,
): boolean {
  if (!lastPingAt) return true;
  const pingedMs = Date.parse(lastPingAt);
  if (Number.isNaN(pingedMs)) return true;
  // >= not >, so the boundary matches the SQL. Migration 201 asks
  // `last_ping_at > now() - interval`, which is FALSE at exactly the threshold
  // and therefore excludes that driver. Comparing age with a bare `>` inverts
  // it — 300s old would read as fresh here and stale there. One instant wide,
  // but "the board applies the identical rule" has to survive being checked.
  return nowMs - pingedMs >= maxAgeSeconds * 1000;
}

/**
 * Human "last seen" for the stale label. Deliberately coarse — the dispatcher
 * needs "minutes or months", not precision.
 *
 * A future timestamp (clock skew between the driver's phone and the server)
 * clamps to 0 rather than rendering "-3m ago".
 */
export function lastSeenLabel(
  lastPingAt: string | null | undefined,
  nowMs: number,
): string {
  if (!lastPingAt) return 'never seen';
  const pingedMs = Date.parse(lastPingAt);
  if (Number.isNaN(pingedMs)) return 'never seen';

  const seconds = Math.max(0, Math.floor((nowMs - pingedMs) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86_400)}d ago`;
}

/**
 * The board's definition of assignable, in one place so the "online drivers"
 * count and the per-row assign button cannot drift apart.
 *
 * `on_job` is excluded the same way it always was — this mirrors
 * nearest_drivers' `d.status = 'online'`, not a new policy.
 */
export function isDispatchable(
  driver: {
    status: 'offline' | 'online' | 'on_job';
    is_verified: boolean;
    last_ping_at: string | null;
  },
  nowMs: number,
  maxAgeSeconds: number = DEFAULT_MAX_PING_AGE_SECONDS,
): boolean {
  return (
    driver.status === 'online' &&
    driver.is_verified &&
    !isPingStale(driver.last_ping_at, nowMs, maxAgeSeconds)
  );
}
