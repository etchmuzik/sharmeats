/**
 * Busy mode — the client half of migration 186.
 *
 * The server shipped a bounded, SELF-EXPIRING prep bump (`set_busy_mode`:
 * 5..60 extra minutes for 15..240 minutes; 0 clears) and nothing called it. A
 * slammed kitchen therefore had no way to tell customers the truth about
 * tonight's prep time, and every ETA — the one at checkout and the one the SLA
 * credit engine measures against — stayed optimistic while the pass fell behind.
 *
 * This module holds only the arithmetic and the presets, so the rules are
 * testable without react-native. The RPC call lives in ./orders.
 */

/**
 * The bumps offered on the tablet. Deliberately a short list of round numbers,
 * all inside mig 186's 5..60 bound: this control is used mid-rush with one hand.
 */
export const BUSY_PRESET_MINUTES = [10, 20, 30] as const;

/**
 * How long one tap of a preset lasts. 60 is the RPC's own default and sits well
 * inside its 15..240 bound. It expires on its own — nobody has to remember to
 * clear it, which is the entire point of reading busy_until rather than a flag.
 */
export const BUSY_DURATION_MINUTES = 60;

/** Passing 0 to set_busy_mode clears busy mode immediately. */
export const BUSY_CLEAR = 0;

const MINUTE_MS = 60_000;

/** The busy fields a brand carries, as read back from restaurants. */
export interface BusyState {
  busyUntil: string | null;
  busyExtraMinutes: number;
}

/** Is this brand's prep bump still applying? Mirrors the RPC's `busy_until > now()`. */
export function isBusyActive(busyUntil: string | null | undefined, nowMs: number): boolean {
  if (!busyUntil) return false;
  const untilMs = new Date(busyUntil).getTime();
  if (Number.isNaN(untilMs)) return false;
  return untilMs > nowMs;
}

/** Whole minutes left on an active bump, rounded up, floored at 1 while active. */
export function busyMinutesRemaining(
  busyUntil: string | null | undefined,
  nowMs: number,
): number {
  if (!isBusyActive(busyUntil, nowMs)) return 0;
  const untilMs = new Date(busyUntil as string).getTime();
  return Math.max(1, Math.ceil((untilMs - nowMs) / MINUTE_MS));
}

/**
 * The kitchen's busy state, collapsed across every brand the account staffs.
 *
 * One account, one kitchen, one pass: the header applies busy mode to all
 * brands in a single action for the same reason the open/closed toggle does.
 * Reporting the LARGEST live bump (and the LONGEST remaining window) keeps the
 * summary honest if a brand was set separately from the web dashboard — it
 * never understates how far behind the kitchen is.
 */
export function summarizeBusy(brands: readonly BusyState[], nowMs: number): {
  active: boolean;
  extraMinutes: number;
  minutesRemaining: number;
} {
  const live = brands.filter((b) => isBusyActive(b.busyUntil, nowMs));
  if (live.length === 0) return { active: false, extraMinutes: 0, minutesRemaining: 0 };
  return {
    active: true,
    extraMinutes: Math.max(...live.map((b) => b.busyExtraMinutes)),
    minutesRemaining: Math.max(...live.map((b) => busyMinutesRemaining(b.busyUntil, nowMs))),
  };
}
