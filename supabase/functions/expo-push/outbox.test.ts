/**
 * Outbox recording and Expo error classification (Package 03 Slices C/D).
 *
 * The two things worth pinning down here are the ones that silently cost money or
 * customers if wrong:
 *
 *   * retry classification — retrying a permanent failure burns quota forever and
 *     can never succeed; NOT retrying a transient one loses the notification,
 *     which is the bug this whole package exists to fix;
 *   * the idempotency key — too coarse and a merchant never hears about a
 *     cancellation because the customer's message already claimed the key; too
 *     fine and a re-fired trigger double-sends.
 */
import { assert, assertEquals, assertNotEquals } from 'jsr:@std/assert';
import { idempotencyKey, isRetryable } from './outbox.ts';

Deno.test('isRetryable: permanent Expo errors are never retried', () => {
  // Per https://docs.expo.dev/push-notifications/sending-notifications/ — the
  // fault is in the message or credentials, so another try cannot help.
  for (const code of [
    'DeviceNotRegistered',
    'MessageTooBig',
    'InvalidCredentials',
    'MismatchSenderId',
    'ExperienceNotFound',
  ]) {
    assertEquals(isRetryable(code), false, `${code} must not be retried`);
  }
});

Deno.test('isRetryable: rate limiting IS retried', () => {
  // The documented backoff case, and the exact failure that used to vanish when
  // index.ts `continue`d past a non-OK chunk.
  assertEquals(isRetryable('MessageRateExceeded'), true);
});

Deno.test('isRetryable: an unknown or absent code is treated as transient', () => {
  // Fail toward retrying: a delivery-critical push dropped because Expo invented
  // a new error name is worse than one extra attempt.
  assertEquals(isRetryable(undefined), true);
  assertEquals(isRetryable(null), true);
  assertEquals(isRetryable('SomeNewCodeExpoAddedLater'), true);
});

Deno.test('idempotencyKey: the same logical event yields the same key', () => {
  const a = idempotencyKey({ event: 'order_accepted', orderId: 'o1' });
  const b = idempotencyKey({ event: 'order_accepted', orderId: 'o1' });
  assertEquals(a, b);
});

Deno.test('idempotencyKey: different events on one order do not collide', () => {
  const accepted = idempotencyKey({ event: 'order_accepted', orderId: 'o1' });
  const ready = idempotencyKey({ event: 'order_ready', orderId: 'o1' });
  assertNotEquals(accepted, ready);
});

Deno.test('idempotencyKey: the same event on different orders does not collide', () => {
  assertNotEquals(
    idempotencyKey({ event: 'order_accepted', orderId: 'o1' }),
    idempotencyKey({ event: 'order_accepted', orderId: 'o2' }),
  );
});

Deno.test('idempotencyKey: customer and merchant versions of one cancellation coexist', () => {
  // notify_order_status_event sends BOTH order_cancelled (to the customer, no
  // explicit recipients) and order_cancelled_merchant (to staff) for the same
  // order. If these shared a key the merchant would never be told to stop
  // cooking.
  const customer = idempotencyKey({ event: 'order_cancelled', orderId: 'o1' });
  const merchant = idempotencyKey({
    event: 'order_cancelled_merchant',
    orderId: 'o1',
    recipientUserIds: ['staff1', 'staff2'],
  });
  assertNotEquals(customer, merchant);
});

Deno.test('idempotencyKey: recipient order does not change the key', () => {
  // The staff set is a SET. If jsonb_agg returned it in a different order on a
  // re-fire, a sorted fingerprint keeps the key stable and the message deduped.
  assertEquals(
    idempotencyKey({ event: 'order_placed_merchant', orderId: 'o1', recipientUserIds: ['a', 'b'] }),
    idempotencyKey({ event: 'order_placed_merchant', orderId: 'o1', recipientUserIds: ['b', 'a'] }),
  );
});

Deno.test('idempotencyKey: a different staff set IS a different message', () => {
  assertNotEquals(
    idempotencyKey({ event: 'order_placed_merchant', orderId: 'o1', recipientUserIds: ['a'] }),
    idempotencyKey({ event: 'order_placed_merchant', orderId: 'o1', recipientUserIds: ['a', 'b'] }),
  );
});

Deno.test('idempotencyKey: campaigns key on the campaign, not the audience', () => {
  // A campaign's recipient list is resolved per send and can be enormous; folding
  // it in would make the key unstable and unbounded. The campaign id is already
  // unique per send.
  const a = idempotencyKey({ event: 'campaign', campaignId: 'c1', recipientUserIds: ['x', 'y'] });
  const b = idempotencyKey({ event: 'campaign', campaignId: 'c1', recipientUserIds: ['z'] });
  assertEquals(a, b, 'same campaign must be one logical message regardless of audience');
  assertNotEquals(
    a,
    idempotencyKey({ event: 'campaign', campaignId: 'c2' }),
    'different campaigns must not collide',
  );
});

Deno.test('idempotencyKey: an orderless event still produces a usable key', () => {
  // credit_issued and referral_rewarded have no order. They must still dedupe,
  // and must not collide with each other.
  const credit = idempotencyKey({ event: 'credit_issued', recipientUserIds: ['u1'] });
  const referral = idempotencyKey({ event: 'referral_rewarded', recipientUserIds: ['u1'] });
  assert(credit.length > 0);
  assertNotEquals(credit, referral);
});

Deno.test('idempotencyKey: never embeds a timestamp', () => {
  // A key containing "now" would defeat the entire purpose — every re-fire would
  // look like a new message. Guard structurally rather than by reading the code.
  const key = idempotencyKey({ event: 'order_accepted', orderId: 'o1' });
  assert(!/\d{4}-\d{2}-\d{2}/.test(key), `key must not contain a date: ${key}`);
  assert(!/\d{10,}/.test(key), `key must not contain an epoch timestamp: ${key}`);
});
