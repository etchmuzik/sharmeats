/**
 * Whether the kitchen is actually being alerted — and the arithmetic behind it.
 *
 * The alerting chain has three independent links (OS push, the in-app chime,
 * the Realtime feed) and every one of them can fail SILENTLY. A kitchen that
 * hears nothing cannot tell "no orders tonight" from "this tablet stopped
 * telling me about orders", and the second one costs a customer forever.
 *
 * So: no link may fail quietly, and the mute toggle may not be permanent. Mute
 * is a bounded, self-expiring window (mig 186's busy mode uses the same shape
 * for the same reason) — a flag someone must remember to clear is a flag that
 * stays set through the Friday rush.
 *
 * Pure module: no react-native, no expo. Every rule here is unit-tested.
 */

/** How long one tap of the mute control silences the chime. */
export const MUTE_DURATION_MINUTES = 30;

const MINUTE_MS = 60_000;

/** Where an OS notification permission actually stands for this tablet. */
export type PushAlertStatus =
  /** Permission granted — the tablet will buzz in the background. */
  | 'granted'
  /** The staffer said no. Background alerting is OFF and must be visible. */
  | 'denied'
  /** Web, simulator, or no Supabase config — push cannot apply here. */
  | 'unsupported'
  /** Not resolved yet (first render) or the check itself failed. */
  | 'unknown';

/** The instant a mute started now would lapse, as an ISO timestamp. */
export function muteUntilFrom(nowMs: number, minutes: number = MUTE_DURATION_MINUTES): string {
  return new Date(nowMs + minutes * MINUTE_MS).toISOString();
}

/**
 * Is a persisted mute still in force?
 *
 * An unparseable stored value returns false — fail LOUD. The failure mode of
 * guessing wrong in the other direction is a permanently silent kitchen.
 */
export function isMuteActive(mutedUntil: string | null | undefined, nowMs: number): boolean {
  if (!mutedUntil) return false;
  const untilMs = new Date(mutedUntil).getTime();
  if (Number.isNaN(untilMs)) return false;
  return untilMs > nowMs;
}

/** Whole minutes left on an active mute, rounded up, floored at 1 while active. */
export function muteMinutesRemaining(
  mutedUntil: string | null | undefined,
  nowMs: number,
): number {
  if (!isMuteActive(mutedUntil, nowMs)) return 0;
  const untilMs = new Date(mutedUntil as string).getTime();
  return Math.max(1, Math.ceil((untilMs - nowMs) / MINUTE_MS));
}

/**
 * Is this tablet currently NOT alerting the kitchen in some way the staff need
 * to see? `unknown`/`unsupported` deliberately do not count: nagging a
 * simulator, or a device whose first permission check has not returned yet,
 * trains people to ignore the banner that matters.
 */
export function alertingIsDegraded(
  pushStatus: PushAlertStatus,
  muted: boolean,
  feedLive: boolean,
): boolean {
  return pushStatus === 'denied' || muted || !feedLive;
}

/** How long a ticket has waited, as m:ss. Shared by the ticket and the banner. */
export function formatWait(totalSeconds: number): string {
  const safe = Number.isFinite(totalSeconds) ? Math.max(0, Math.floor(totalSeconds)) : 0;
  const minutes = Math.floor(safe / 60);
  const seconds = safe % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

/**
 * Seconds the OLDEST unaccepted ticket has been waiting.
 *
 * Malformed timestamps are skipped rather than treated as 0: the banner exists
 * to state the worst wait, and letting one bad row report "0:00" would
 * understate exactly the number the kitchen is meant to react to.
 */
export function oldestWaitSeconds(
  placedAtValues: readonly string[],
  nowMs: number,
): number {
  let worst = 0;
  for (const placedAt of placedAtValues) {
    const placedMs = new Date(placedAt).getTime();
    if (Number.isNaN(placedMs)) continue;
    worst = Math.max(worst, Math.round((nowMs - placedMs) / 1000));
  }
  return Math.max(0, worst);
}
