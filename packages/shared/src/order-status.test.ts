import { describe, it, expect } from 'vitest';
import {
  canTransition,
  nextForwardStatus,
  isTerminal,
  allowedNextStatuses,
  HAPPY_PATH,
  TERMINAL_STATUSES,
  type OrderStatus,
} from './order-status';

// These tests pin the client-side state machine to the SAME rules the server
// advance_order_status RPC enforces (supabase/migrations/011 + 033). If they
// drift, the customer/driver UIs would offer transitions the server rejects.

describe('order status — happy path', () => {
  it('walks placed → delivered one forward step at a time', () => {
    for (let i = 0; i < HAPPY_PATH.length - 1; i++) {
      expect(nextForwardStatus(HAPPY_PATH[i])).toBe(HAPPY_PATH[i + 1]);
    }
  });

  it('delivered has no forward status', () => {
    expect(nextForwardStatus('delivered')).toBeNull();
  });
});

describe('order status — terminal states', () => {
  it.each(TERMINAL_STATUSES)('%s is terminal', (s) => {
    expect(isTerminal(s)).toBe(true);
  });

  it('in-flight statuses are not terminal', () => {
    for (const s of ['placed', 'accepted', 'preparing', 'ready', 'picked_up', 'out_for_delivery'] as OrderStatus[]) {
      expect(isTerminal(s)).toBe(false);
    }
  });
});

describe('order status — authorization', () => {
  it('a merchant can accept a placed order; a driver cannot', () => {
    expect(canTransition('placed', 'accepted', 'merchant')).toBe(true);
    expect(canTransition('placed', 'accepted', 'driver')).toBe(false);
  });

  it('a driver can move ready → picked_up but not placed → accepted', () => {
    expect(canTransition('ready', 'picked_up', 'driver')).toBe(true);
    expect(canTransition('placed', 'accepted', 'driver')).toBe(false);
  });

  it('admin can make any legal transition', () => {
    expect(canTransition('placed', 'accepted', 'admin')).toBe(true);
    expect(canTransition('out_for_delivery', 'delivered', 'admin')).toBe(true);
  });

  it('illegal jumps are rejected even for admin', () => {
    // placed → delivered is not a single legal edge.
    expect(canTransition('placed', 'delivered', 'admin')).toBe(false);
  });

  it('a customer can cancel only a placed order', () => {
    expect(canTransition('placed', 'cancelled', 'customer')).toBe(true);
    expect(canTransition('preparing', 'cancelled', 'customer')).toBe(false);
  });

  it('allowedNextStatuses never includes a backward move', () => {
    const next = allowedNextStatuses('ready', 'driver');
    expect(next).toContain('picked_up');
    expect(next).not.toContain('accepted');
  });
});
