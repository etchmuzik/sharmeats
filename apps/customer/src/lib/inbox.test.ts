/**
 * Notification inbox logic (Package 03 Slice H).
 *
 * The two properties worth guarding hardest:
 *
 *   * the inbox must reuse the Slice F route allow-list, not define a second one.
 *     Two lists drift, and the inbox would become a way to reach screens the push
 *     layer deliberately refuses (/signin, /delete-account);
 *   * a row that navigates nowhere must not look tappable — a dead press reads as
 *     the app being broken, which is the spec's "expired order actions degrade
 *     safely".
 */
import { describe, it, expect, afterEach } from 'vitest';
import {
  inboxCopyKeys,
  inboxRoute,
  isInboxEnabled,
  isInboxRowTappable,
  isUnread,
} from './inbox';
import type { InboxMessage } from '../data/types';

const UUID = '11111111-2222-3333-4444-555555555555';

function msg(over: Partial<InboxMessage> = {}): InboxMessage {
  return {
    id: 'm-1',
    event: 'order_delivered',
    category: 'operational',
    queuedAt: '2026-07-30T10:00:00.000Z',
    ...over,
  };
}

const ORIGINAL_FLAG = process.env.EXPO_PUBLIC_INBOX_ENABLED;
afterEach(() => {
  if (ORIGINAL_FLAG === undefined) delete process.env.EXPO_PUBLIC_INBOX_ENABLED;
  else process.env.EXPO_PUBLIC_INBOX_ENABLED = ORIGINAL_FLAG;
});

describe('isInboxEnabled', () => {
  it('is OFF by default — the transport gate is unmet, so a blank inbox must not ship on', () => {
    delete process.env.EXPO_PUBLIC_INBOX_ENABLED;
    expect(isInboxEnabled()).toBe(false);
  });

  it('is on only for the exact string "true"', () => {
    process.env.EXPO_PUBLIC_INBOX_ENABLED = 'true';
    expect(isInboxEnabled()).toBe(true);
  });

  it('a typo leaves it dark rather than half-enabled', () => {
    for (const v of ['TRUE', '1', 'yes', 'on', '']) {
      process.env.EXPO_PUBLIC_INBOX_ENABLED = v;
      expect(isInboxEnabled()).toBe(false);
    }
  });
});

describe('inboxRoute reuses the Slice F allow-list', () => {
  it('allows a listed route', () => {
    expect(inboxRoute(msg({ route: '/(tabs)/rewards' }))).toBe('/(tabs)/rewards');
  });

  it('REFUSES /signin even though it is a real screen', () => {
    // If the inbox had its own list, this is exactly what would drift.
    expect(inboxRoute(msg({ route: '/signin' }))).toBeNull();
  });

  it('refuses /delete-account', () => {
    expect(inboxRoute(msg({ route: '/delete-account' }))).toBeNull();
  });

  it('refuses traversal and query smuggling', () => {
    expect(inboxRoute(msg({ route: '/../../admin' }))).toBeNull();
    expect(inboxRoute(msg({ route: `/order/${UUID}?next=/signin` }))).toBeNull();
  });

  it('falls back to the order when no explicit route is given', () => {
    expect(inboxRoute(msg({ orderId: UUID }))).toBe(`/order/${UUID}`);
  });

  it('prefers an allowed explicit route over the order fallback', () => {
    expect(inboxRoute(msg({ route: '/support', orderId: UUID }))).toBe('/support');
  });

  it('falls back to the order when the explicit route is refused', () => {
    expect(inboxRoute(msg({ route: '/signin', orderId: UUID }))).toBe(`/order/${UUID}`);
  });

  it('returns null for a junk order id rather than building /order/junk', () => {
    expect(inboxRoute(msg({ orderId: 'not-a-uuid' }))).toBeNull();
  });
});

describe('degrading safely', () => {
  it('a row that resolves to no route is NOT tappable', () => {
    // The spec's "expired order actions degrade safely": a dead press reads as a
    // broken app, so the row must not invite one.
    expect(isInboxRowTappable(msg({ event: 'tier_promoted' }))).toBe(false);
  });

  it('a row with a valid destination IS tappable', () => {
    expect(isInboxRowTappable(msg({ orderId: UUID }))).toBe(true);
  });

  it('a message whose order was deleted degrades to untappable, not to a crash', () => {
    expect(() => isInboxRowTappable(msg({ orderId: '' }))).not.toThrow();
    expect(isInboxRowTappable(msg({ orderId: '' }))).toBe(false);
  });
});

describe('inboxCopyKeys', () => {
  it('gives an order event the order label', () => {
    expect(inboxCopyKeys(msg({ event: 'order_delivered' })).titleKey).toBe('inbox.labelOrder');
  });

  it('groups related events under one label rather than one string each', () => {
    // The point of labels: the inbox does NOT re-author the push sentence, so all
    // order-status events share a category. Duplicating copy.ts in the bundle would
    // give two sources of truth for one sentence.
    for (const e of ['order_paid', 'order_ready', 'order_cancelled', 'driver_assigned']) {
      expect(inboxCopyKeys(msg({ event: e })).titleKey).toBe('inbox.labelOrder');
    }
  });

  it('separates rewards, payment, messages and reminders', () => {
    expect(inboxCopyKeys(msg({ event: 'credit_issued' })).titleKey).toBe('inbox.labelReward');
    expect(inboxCopyKeys(msg({ event: 'payment_failed' })).titleKey).toBe('inbox.labelPayment');
    expect(inboxCopyKeys(msg({ event: 'support_reply' })).titleKey).toBe('inbox.labelMessage');
    expect(inboxCopyKeys(msg({ event: 'cart_reminder' })).titleKey).toBe('inbox.labelReminder');
    expect(inboxCopyKeys(msg({ event: 'campaign' })).titleKey).toBe('inbox.labelOffer');
  });

  it('falls back for an unknown event rather than showing a raw i18n key', () => {
    // A missing translation would otherwise render "notification.some_future.title"
    // to a customer.
    expect(inboxCopyKeys(msg({ event: 'some_future_event' })).titleKey).toBe('inbox.labelGeneric');
  });

  it('shows campaign body verbatim, because those words are what actually went out', () => {
    const k = inboxCopyKeys(msg({ event: 'campaign', customBody: 'Two for one this weekend.' }));
    expect(k.literalBody).toBe('Two for one this weekend.');
  });

  it('has no literal body for an ordinary event', () => {
    expect(inboxCopyKeys(msg({ event: 'order_delivered' })).literalBody).toBeUndefined();
  });

  it('every labelled event maps to a key under the inbox namespace', () => {
    // Guards against a typo'd key that would render as raw text.
    for (const e of ['order_paid', 'credit_issued', 'new_message', 'reorder_reminder', 'campaign']) {
      expect(inboxCopyKeys(msg({ event: e })).titleKey.startsWith('inbox.label')).toBe(true);
    }
  });
});

describe('isUnread', () => {
  it('unread when never read in the inbox', () => {
    expect(isUnread(msg())).toBe(true);
  });

  it('read once readAt is set', () => {
    expect(isUnread(msg({ readAt: '2026-07-30T11:00:00.000Z' }))).toBe(false);
  });

  it('a TAPPED push is still unread until read in the inbox', () => {
    // openedAt is attribution, not UI state. Treating a tap as "read" would
    // silently mark things read the customer never opened in the list.
    expect(isUnread(msg({ openedAt: '2026-07-30T10:30:00.000Z' }))).toBe(true);
  });
});
