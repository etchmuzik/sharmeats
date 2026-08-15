import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  store: new Map<string, string>(),
  taskStarted: false,
  startLocation: vi.fn(),
  stopLocation: vi.fn(),
  rpc: vi.fn(),
}));

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn(async (key: string) => h.store.get(key) ?? null),
    setItem: vi.fn(async (key: string, value: string) => {
      h.store.set(key, value);
    }),
    removeItem: vi.fn(async (key: string) => {
      h.store.delete(key);
    }),
  },
}));

vi.mock('expo-location', () => ({
  Accuracy: { Balanced: 3, Low: 1 },
  ActivityType: { AutomotiveNavigation: 1, OtherNavigation: 2 },
  requestForegroundPermissionsAsync: vi.fn(async () => ({ status: 'granted' })),
  requestBackgroundPermissionsAsync: vi.fn(async () => ({ status: 'granted' })),
  getCurrentPositionAsync: vi.fn(async () => ({
    coords: { longitude: 34.3, latitude: 27.9 },
  })),
  hasStartedLocationUpdatesAsync: vi.fn(async () => h.taskStarted),
  startLocationUpdatesAsync: h.startLocation.mockImplementation(async () => {
    h.taskStarted = true;
  }),
  stopLocationUpdatesAsync: h.stopLocation.mockImplementation(async () => {
    h.taskStarted = false;
  }),
}));

vi.mock('./backgroundLocationTask', () => ({
  ACTIVE_ORDER_STORAGE_KEY: '@test/active-order',
  DRIVER_ONLINE_STORAGE_KEY: '@test/online',
  DRIVER_LOCATION_TASK: 'test-driver-location',
}));

vi.mock('./supabase', () => ({
  getSupabase: () => ({ rpc: h.rpc }),
}));

vi.mock('./i18n', () => ({
  DRIVER_LOCALE_STORAGE_KEY: '@test/locale',
  trackingNotificationCopy: () => ({ title: 'Delivery', body: 'Tracking' }),
  presenceNotificationCopy: () => ({ title: 'Online', body: 'Ready for offers' }),
}));

import {
  startIdleHeartbeat,
  startStreaming,
  stopIdleHeartbeat,
  stopStreaming,
} from './location';

describe('driver idle presence', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    h.store.clear();
    h.taskStarted = false;
    h.startLocation.mockClear();
    h.stopLocation.mockClear();
    h.rpc.mockReset().mockResolvedValue({ error: null });
  });

  afterEach(async () => {
    await stopIdleHeartbeat();
    vi.useRealTimers();
  });

  it('persists online intent and starts an OS-backed task for a pocketed phone', async () => {
    await startIdleHeartbeat();

    expect(h.store.get('@test/online')).toBe('1');
    expect(h.startLocation).toHaveBeenCalledWith(
      'test-driver-location',
      expect.objectContaining({
        pausesUpdatesAutomatically: false,
        distanceInterval: 0,
        timeInterval: expect.any(Number),
      }),
    );
    const options = h.startLocation.mock.calls[0]?.[1] as { timeInterval: number };
    expect(options.timeInterval).toBeLessThan(300_000 / 2);
  });

  it('does not stack background tasks when started twice', async () => {
    await startIdleHeartbeat();
    await startIdleHeartbeat();

    expect(h.startLocation).toHaveBeenCalledTimes(1);
  });

  it('stops the OS task and clears online intent when going offline', async () => {
    await startIdleHeartbeat();
    await stopIdleHeartbeat();

    expect(h.store.has('@test/online')).toBe(false);
    expect(h.stopLocation).toHaveBeenCalledTimes(1);
  });

  it('switches to delivery tracking, then resumes idle presence after handoff', async () => {
    await startIdleHeartbeat();
    h.startLocation.mockClear();

    await startStreaming('order-1');
    expect(h.store.get('@test/active-order')).toBe('order-1');
    expect(h.startLocation).toHaveBeenCalledTimes(1);

    h.startLocation.mockClear();
    await stopStreaming();
    expect(h.store.has('@test/active-order')).toBe(false);
    expect(h.store.get('@test/online')).toBe('1');
    expect(h.startLocation).toHaveBeenCalledTimes(1);
  });

  it('keeps a foreground heartbeat as a supplement to the OS task', async () => {
    await startIdleHeartbeat();
    h.rpc.mockClear();

    await vi.advanceTimersByTimeAsync(120_000);

    expect(h.rpc).toHaveBeenCalledWith('driver_ping', {
      p_lng: 34.3,
      p_lat: 27.9,
      p_status: '',
    });
  });
});
