import { afterEach, describe, expect, it } from 'vitest';
import { scheduledOrdersEnabled } from './scheduledOrders';

const ORIGINAL_FLAG = process.env.EXPO_PUBLIC_SCHEDULED_ORDERS_ENABLED;

afterEach(() => {
  if (ORIGINAL_FLAG === undefined) {
    delete process.env.EXPO_PUBLIC_SCHEDULED_ORDERS_ENABLED;
  } else {
    process.env.EXPO_PUBLIC_SCHEDULED_ORDERS_ENABLED = ORIGINAL_FLAG;
  }
});

describe('scheduledOrdersEnabled', () => {
  it('fails closed when no release flag is configured', () => {
    delete process.env.EXPO_PUBLIC_SCHEDULED_ORDERS_ENABLED;
    expect(scheduledOrdersEnabled()).toBe(false);
  });

  it('enables scheduling only for the exact string "true"', () => {
    process.env.EXPO_PUBLIC_SCHEDULED_ORDERS_ENABLED = 'true';
    expect(scheduledOrdersEnabled()).toBe(true);
  });

  it('keeps scheduling dark for malformed values', () => {
    for (const value of ['TRUE', '1', 'yes', 'on', '']) {
      process.env.EXPO_PUBLIC_SCHEDULED_ORDERS_ENABLED = value;
      expect(scheduledOrdersEnabled()).toBe(false);
    }
  });
});
