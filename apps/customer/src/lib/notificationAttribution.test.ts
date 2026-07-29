/**
 * Notification attribution window (Package 03 Slice F).
 *
 * The failure this guards against is subtle and expensive: without an expiry,
 * EVERY order a customer ever places gets credited to the last notification they
 * happened to tap. That is worse than no attribution, because a push that drove a
 * sale and one that was tapped and ignored become indistinguishable — and someone
 * then makes spending decisions on the difference.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  clearNotificationAttribution,
  notificationAttribution,
  openAttributionWindow,
} from './notificationAttribution';

beforeEach(() => {
  clearNotificationAttribution();
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  clearNotificationAttribution();
});

describe('notificationAttribution', () => {
  it('is empty before any notification is tapped', () => {
    expect(notificationAttribution()).toEqual({});
  });

  it('attributes events after a tap', () => {
    openAttributionWindow('11111111-2222-3333-4444-555555555555');
    expect(notificationAttribution()).toEqual({
      attributed_message_id: '11111111-2222-3333-4444-555555555555',
    });
  });

  it('carries the campaign id when the push had one', () => {
    openAttributionWindow('msg-1', 'camp-9');
    expect(notificationAttribution()).toEqual({
      attributed_message_id: 'msg-1',
      attributed_campaign_id: 'camp-9',
    });
  });

  it('omits the campaign key entirely for a non-campaign push', () => {
    // Not `attributed_campaign_id: undefined` — an explicit undefined would be
    // dropped downstream anyway, but omitting keeps the payload honest.
    openAttributionWindow('msg-1');
    expect('attributed_campaign_id' in notificationAttribution()).toBe(false);
  });

  it('still attributes just inside the 30-minute window', () => {
    openAttributionWindow('msg-1');
    vi.advanceTimersByTime(29 * 60 * 1000);
    expect(notificationAttribution().attributed_message_id).toBe('msg-1');
  });

  it('STOPS attributing once the window closes', () => {
    // The whole point. Tomorrow's dinner is not credited to today's push.
    openAttributionWindow('msg-1');
    vi.advanceTimersByTime(31 * 60 * 1000);
    expect(notificationAttribution()).toEqual({});
  });

  it('stays closed on subsequent reads after expiry', () => {
    openAttributionWindow('msg-1');
    vi.advanceTimersByTime(31 * 60 * 1000);
    notificationAttribution();
    expect(notificationAttribution()).toEqual({});
  });

  it('a newer tap replaces an older one', () => {
    openAttributionWindow('old');
    vi.advanceTimersByTime(10 * 60 * 1000);
    openAttributionWindow('new');
    expect(notificationAttribution().attributed_message_id).toBe('new');
  });

  it('a newer tap also extends the window', () => {
    openAttributionWindow('old');
    vi.advanceTimersByTime(29 * 60 * 1000);
    openAttributionWindow('new');
    // 29 min after the FIRST tap, but only just after the second.
    vi.advanceTimersByTime(5 * 60 * 1000);
    expect(notificationAttribution().attributed_message_id).toBe('new');
  });

  it('clearing forgets the window immediately — the sign-out contract', () => {
    // Identity teardown calls this. If it did not, the next person to use the
    // device would have their orders credited to the previous person's campaign.
    openAttributionWindow('msg-1', 'camp-1');
    clearNotificationAttribution();
    expect(notificationAttribution()).toEqual({});
  });
});
