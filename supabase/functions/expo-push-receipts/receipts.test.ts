/**
 * Receipt classification (Package 03 Slice E).
 *
 * The failure modes these guard against, in order of how much they'd cost:
 *
 *   * treating an ABSENT receipt as failure -> re-sending a push that already
 *     arrived, so the customer gets it twice;
 *   * treating an absent receipt as success -> silently losing one that never
 *     arrived, which is the exact bug this package exists to fix;
 *   * retrying a permanent failure -> burning Expo quota forever on a device
 *     that has uninstalled;
 *   * alerting per dead token -> pager noise that gets the alert muted, so the
 *     one that matters (broken credentials, every push failing) is ignored.
 */
import { assert, assertEquals, assertFalse } from 'jsr:@std/assert';
import {
  chunkTicketIds,
  classifyReceipt,
  isProjectWideFailure,
  RECEIPT_CHUNK_SIZE,
  shouldPruneToken,
  stillWorthSending,
} from './receipts.ts';

const sentAt = new Date('2026-07-30T10:00:00Z');
const soonAfter = new Date('2026-07-30T10:20:00Z'); // 20 min later
const muchLater = new Date('2026-07-31T12:00:00Z'); // >24h later

Deno.test('an ok receipt means the provider accepted it — not that anyone saw it', () => {
  const v = classifyReceipt({ status: 'ok' }, { sentAt, now: soonAfter });
  assertEquals(v.kind, 'provider_accepted');
});

Deno.test('an ABSENT receipt is unknown, not a failure', () => {
  // The critical one. Expo has simply not decided yet; re-sending here would
  // double-notify a customer who already got the push.
  const v = classifyReceipt(undefined, { sentAt, now: soonAfter });
  assertEquals(v.kind, 'unknown');
});

Deno.test('an absent receipt past the retention deadline is expired, not failed', () => {
  // "We never found out" is not the same as "it failed". Counting unknowns as
  // failures would overstate the failure rate in operator UI.
  const v = classifyReceipt(undefined, { sentAt, now: muchLater });
  assertEquals(v.kind, 'expired');
});

Deno.test('DeviceNotRegistered is permanent and prunes the token', () => {
  const v = classifyReceipt(
    { status: 'error', details: { error: 'DeviceNotRegistered' }, message: 'gone' },
    { sentAt, now: soonAfter },
  );
  assertEquals(v.kind, 'permanent_failed');
  assert(shouldPruneToken('DeviceNotRegistered'));
});

Deno.test('MessageTooBig is permanent — the same payload cannot fit on a retry', () => {
  const v = classifyReceipt(
    { status: 'error', details: { error: 'MessageTooBig' } },
    { sentAt, now: soonAfter },
  );
  assertEquals(v.kind, 'permanent_failed');
});

Deno.test('an unknown error code is retryable, not permanent', () => {
  // Fail toward retrying: a delivery-critical push dropped because Expo added a
  // new error name is worse than one extra attempt, and the attempt cap bounds it.
  const v = classifyReceipt(
    { status: 'error', details: { error: 'SomethingExpoAddedIn2027' } },
    { sentAt, now: soonAfter },
  );
  assertEquals(v.kind, 'retryable_failed');
});

Deno.test('an error with no code at all is still retryable', () => {
  const v = classifyReceipt({ status: 'error' }, { sentAt, now: soonAfter });
  assertEquals(v.kind, 'retryable_failed');
});

Deno.test('only project-wide codes alert; a dead token never does', () => {
  // Alerting on every DeviceNotRegistered is how an alert channel gets muted,
  // and then nobody notices the credentials breaking.
  assertFalse(isProjectWideFailure('DeviceNotRegistered'));
  assertFalse(isProjectWideFailure('MessageRateExceeded'));
  assertFalse(isProjectWideFailure(null));
  for (const code of ['InvalidCredentials', 'MismatchSenderId', 'ExperienceNotFound']) {
    assert(isProjectWideFailure(code), `${code} must alert`);
  }
});

Deno.test('only DeviceNotRegistered prunes a token', () => {
  // Pruning on a transient error would delete a live device's token and stop all
  // its future notifications.
  assertFalse(shouldPruneToken('MessageRateExceeded'));
  assertFalse(shouldPruneToken('InvalidCredentials'));
  assertFalse(shouldPruneToken(undefined));
});

Deno.test('receipt detail carries Expo diagnostics, never our copy', () => {
  const v = classifyReceipt(
    { status: 'error', details: { error: 'Whatever' }, message: 'Expo says: bad token' },
    { sentAt, now: soonAfter },
  );
  assertEquals(v.kind, 'retryable_failed');
  if (v.kind === 'retryable_failed') {
    assertEquals(v.detail, 'Expo says: bad token');
  }
});

Deno.test('stillWorthSending honours the per-event expiry', () => {
  const now = new Date('2026-07-30T12:00:00Z');
  // A courier-arriving push whose 30-minute window closed is worse than silence:
  // it is misinformation.
  assertFalse(stillWorthSending(new Date('2026-07-30T11:30:00Z'), now));
  // A settlement notice is still useful days later.
  assert(stillWorthSending(new Date('2026-08-05T00:00:00Z'), now));
});

Deno.test('ticket ids chunk at Expo documented 1000 per request', () => {
  assertEquals(RECEIPT_CHUNK_SIZE, 1000);
  const ids = Array.from({ length: 2500 }, (_, i) => `t${i}`);
  const chunks = chunkTicketIds(ids);
  assertEquals(chunks.length, 3);
  assertEquals(chunks[0].length, 1000);
  assertEquals(chunks[1].length, 1000);
  assertEquals(chunks[2].length, 500);
  // Nothing dropped, nothing duplicated.
  assertEquals(chunks.flat().length, ids.length);
  assertEquals(new Set(chunks.flat()).size, ids.length);
});

Deno.test('chunking an empty list yields no requests', () => {
  assertEquals(chunkTicketIds([]).length, 0);
});
