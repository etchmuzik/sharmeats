import { assertEquals } from 'jsr:@std/assert';
import { ESSENTIAL_EVENTS, recipientsAfterPrefs, type PrefRow } from './prefs.ts';

const A = 'user-a';
const B = 'user-b';
const optedOut = (id: string): PrefRow => ({ user_id: id, transactional: false });
const optedIn = (id: string): PrefRow => ({ user_id: id, transactional: true });

Deno.test('optional event: an explicit opt-out is suppressed', () => {
  assertEquals(recipientsAfterPrefs('order_accepted', [A, B], [optedOut(A)]), [B]);
});

Deno.test('optional event: a missing prefs row means default ON', () => {
  // mig 138 default is transactional = true, so silence is consent HERE
  // (the opposite of marketing, which is opt-in).
  assertEquals(recipientsAfterPrefs('order_accepted', [A, B], []), [A, B]);
});

Deno.test('optional event: an explicit opt-IN still receives', () => {
  assertEquals(recipientsAfterPrefs('order_accepted', [A], [optedIn(A)]), [A]);
});

Deno.test('optional event: everyone opted out yields an empty list', () => {
  assertEquals(recipientsAfterPrefs('new_message', [A, B], [optedOut(A), optedOut(B)]), []);
});

Deno.test('ESSENTIAL events ignore the preference entirely', () => {
  // The whole point of the exemption list: muting notifications must never
  // stop the message that a courier is at the door or that money moved.
  for (const event of [
    'order_out_for_delivery',
    'driver_assigned',
    'order_cancelled',
    'payment_failed',
    'credit_issued',
    'new_offer',
    'order_placed_merchant',
  ]) {
    assertEquals(
      recipientsAfterPrefs(event, [A, B], [optedOut(A), optedOut(B)]),
      [A, B],
      `${event} must not be suppressible`,
    );
  }
});

Deno.test('a failed prefs lookup fails OPEN (sends anyway)', () => {
  // Dropping a wanted order update is worse than one extra notification.
  assertEquals(recipientsAfterPrefs('order_accepted', [A, B], null), [A, B]);
});

Deno.test('the exemption list covers every delivery-critical event', () => {
  // Guards against someone adding a new courier/money event and forgetting to
  // exempt it — these names must stay essential.
  for (const must of [
    'order_out_for_delivery',
    'order_picked_up',
    'order_ready',
    'order_ready_pickup',
    'order_rejected',
    'order_cancelled',
    'payment_failed',
    'order_paid',
    'new_offer',
  ]) {
    assertEquals(ESSENTIAL_EVENTS.has(must), true, `${must} must be in ESSENTIAL_EVENTS`);
  }
});

Deno.test('informational events remain suppressible', () => {
  // If one of these ever becomes exempt, the switch stops meaning anything.
  for (const optional of [
    'order_accepted',
    'order_delivered',
    'new_message',
    'support_reply',
    'tier_promoted',
    'referral_rewarded',
    'campaign',
  ]) {
    assertEquals(ESSENTIAL_EVENTS.has(optional), false, `${optional} must stay suppressible`);
  }
});

Deno.test('preserves recipient order and does not mutate the input', () => {
  const ids = [A, B, 'user-c'];
  const out = recipientsAfterPrefs('order_accepted', ids, [optedOut(B)]);
  assertEquals(out, [A, 'user-c']);
  assertEquals(ids, [A, B, 'user-c']);
});
