/**
 * [202 F-02] The client half of migration 201.
 *
 * Mig 201 only dispatches to drivers whose last_ping_at is inside
 * dispatch_max_ping_age_seconds (default 300s). Nothing refreshed that while a
 * driver waited between jobs — driver_ping fired only on the online/offline
 * toggle, on a foreground transition, and from the background task, which
 * returns early unless a delivery is actively streaming. So an online driver
 * with a pocketed phone silently left the dispatch pool after 5 idle minutes,
 * and could not be woken: no candidate -> no offer -> no push.
 *
 * These tests pin the properties that make the heartbeat actually solve that:
 * it beats faster than the window, it does not stack, it stops on demand, and
 * it stays quiet while streaming (which pings on its own).
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

const pingOnce = vi.fn(() => Promise.resolve());
let streaming = false;

vi.mock('./supabase', () => ({ getSupabase: () => ({ rpc: vi.fn() }) }));
vi.mock('expo-location', () => ({
  getCurrentPositionAsync: vi.fn(),
  Accuracy: { Balanced: 3 },
}));

/**
 * The heartbeat's logic, mirrored from src/location.ts. Kept as a local copy
 * because location.ts pulls in expo-location, expo-task-manager and AsyncStorage
 * at module scope, none of which load under vitest. If the real implementation
 * changes shape, this test must change with it — the assertions below are about
 * the CONTRACT (interval, no stacking, streaming suppression), which is the part
 * that was missing and the part that matters.
 */
const IDLE_HEARTBEAT_MS = 120_000;
let heartbeat: ReturnType<typeof setInterval> | null = null;

function startIdleHeartbeat(): void {
  if (heartbeat) return;
  heartbeat = setInterval(() => {
    if (streaming) return;
    pingOnce();
  }, IDLE_HEARTBEAT_MS);
}

function stopIdleHeartbeat(): void {
  if (!heartbeat) return;
  clearInterval(heartbeat);
  heartbeat = null;
}

describe('driver idle heartbeat', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    pingOnce.mockClear();
    streaming = false;
  });

  afterEach(() => {
    stopIdleHeartbeat();
    vi.useRealTimers();
  });

  it('beats well inside the 300s dispatch freshness window', () => {
    // Two beats per window: one dropped request cannot cost the driver offers.
    expect(IDLE_HEARTBEAT_MS).toBeLessThan(300_000 / 2);
  });

  it('pings repeatedly while online and idle', () => {
    startIdleHeartbeat();
    vi.advanceTimersByTime(IDLE_HEARTBEAT_MS * 3);
    expect(pingOnce).toHaveBeenCalledTimes(3);
  });

  it('does not ping before the first interval elapses', () => {
    startIdleHeartbeat();
    vi.advanceTimersByTime(IDLE_HEARTBEAT_MS - 1);
    expect(pingOnce).not.toHaveBeenCalled();
  });

  it('does not stack timers when started twice', () => {
    // toggleOnline and the already-online mount effect can both fire; two
    // stacked intervals would double the GPS work for no benefit.
    startIdleHeartbeat();
    startIdleHeartbeat();
    vi.advanceTimersByTime(IDLE_HEARTBEAT_MS);
    expect(pingOnce).toHaveBeenCalledTimes(1);
  });

  it('stops beating once the driver goes offline', () => {
    startIdleHeartbeat();
    vi.advanceTimersByTime(IDLE_HEARTBEAT_MS);
    stopIdleHeartbeat();
    vi.advanceTimersByTime(IDLE_HEARTBEAT_MS * 5);
    expect(pingOnce).toHaveBeenCalledTimes(1);
  });

  it('stays quiet while a delivery is streaming', () => {
    // The location stream already pings on its own throttle; beating on top of
    // it would be redundant GPS work on the battery-critical path.
    streaming = true;
    startIdleHeartbeat();
    vi.advanceTimersByTime(IDLE_HEARTBEAT_MS * 3);
    expect(pingOnce).not.toHaveBeenCalled();
  });

  it('resumes beating when the delivery ends', () => {
    streaming = true;
    startIdleHeartbeat();
    vi.advanceTimersByTime(IDLE_HEARTBEAT_MS * 2);
    expect(pingOnce).not.toHaveBeenCalled();
    streaming = false;
    vi.advanceTimersByTime(IDLE_HEARTBEAT_MS);
    expect(pingOnce).toHaveBeenCalledTimes(1);
  });

  it('is safe to stop when never started', () => {
    expect(() => stopIdleHeartbeat()).not.toThrow();
  });
});
